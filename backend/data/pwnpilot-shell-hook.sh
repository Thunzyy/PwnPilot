#!/bin/bash
# PwnPilot Shell Hook - Captures terminal commands for AI context
# This script is sourced automatically in PwnPilot terminal sessions
# Supports both bash and zsh

# Required environment variables (set by tmux session):
# PP_API_URL     - Backend API URL
# PP_SESSION_ID  - Terminal session ID
# PP_TOKEN       - JWT auth token
# PP_PROJECT_ID  - Associated project ID

# Exit silently if not in a PwnPilot session
[[ -z "$PP_SESSION_ID" ]] && return 0

# Avoid duplicate hook registration when sourced multiple times.
if [[ -n "${_PP_HOOK_INSTALLED:-}" ]]; then
    return 0
fi
_PP_HOOK_INSTALLED=1

# Internal state
typeset -g _PP_CMD=""
typeset -g _PP_CWD=""
typeset -g _PP_START=0
typeset -g _PP_BUFFER_LINES=0
typeset -g _PP_STATE_FILE="${PP_SESSION_STATE_FILE:-}"

# Max output size to capture (bytes)
typeset -g _PP_MAX_OUTPUT=5000

_pwnpilot_write_state() {
    [[ -z "$_PP_STATE_FILE" ]] && return
    mkdir -p "$(dirname "$_PP_STATE_FILE")" 2>/dev/null || return
    printf '%s' "$1" > "$_PP_STATE_FILE" 2>/dev/null || true
}

# Pre-exec hook - called before command execution
_pwnpilot_preexec() {
    local cmd="$1"

    # Skip empty commands or hook functions
    [[ -z "$cmd" ]] && return
    [[ "$cmd" == _pwnpilot_* ]] && return
    [[ "$cmd" == source* ]] && return

    _PP_CMD="$cmd"
    _PP_CWD="$PWD"
    _PP_START=$(date +%s%3N 2>/dev/null || echo $(($(date +%s) * 1000)))
    _pwnpilot_write_state "busy"

    # Snapshot content line count (last non-blank line) for output diff
    # Note: capture-pane from inside the pane includes trailing blank rows,
    # so we use awk to find the last non-blank line number instead of wc -l
    _PP_BUFFER_LINES=$(tmux capture-pane -p -S - 2>/dev/null | awk '/./{n=NR} END{print n+0}')
}

# Post-exec hook - called after command execution
_pwnpilot_postexec() {
    local exit_code=$?

    # Skip if no command was tracked
    [[ -z "$_PP_CMD" ]] && return

    local end_time=$(date +%s%3N 2>/dev/null || echo $(($(date +%s) * 1000)))
    local duration=$((end_time - _PP_START))

    # Capture output by diffing pane buffer before/after command execution
    local raw_output=""
    if (( _PP_BUFFER_LINES > 0 )); then
        local capture_file="/tmp/pp_capture_$$"
        tmux capture-pane -p -S - > "$capture_file" 2>/dev/null
        # Count last non-blank line (same method as preexec)
        local current_lines
        current_lines=$(awk '/./{n=NR} END{print n+0}' "$capture_file")
        local new_lines=$((current_lines - _PP_BUFFER_LINES))
        if (( new_lines > 0 )); then
            # Extract new lines: get content up to last non-blank, then tail
            raw_output=$(head -n "$current_lines" "$capture_file" | tail -n "$new_lines")
        fi
        rm -f "$capture_file"
    fi

    # Escape JSON special characters using python
    local json_cmd json_cwd json_output
    json_cmd=$(printf '%s' "$_PP_CMD" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"$_PP_CMD\"")
    json_cwd=$(printf '%s' "$_PP_CWD" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"$_PP_CWD\"")

    if [[ -n "$raw_output" ]]; then
        # Trim trailing whitespace/empty lines
        raw_output=$(printf '%s' "$raw_output" | sed 's/[[:space:]]*$//')
        if (( ${#raw_output} > _PP_MAX_OUTPUT )); then
            raw_output="${raw_output:0:$_PP_MAX_OUTPUT}..."
        fi
        json_output=$(printf '%s' "$raw_output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "null")
    else
        json_output="null"
    fi

    # Send to API without generating job control notifications
    # zsh: &! auto-disowns; bash: disown after &
    if [[ -n "$ZSH_VERSION" ]]; then
        {
            curl -s -X POST "${PP_API_URL}/terminal/sessions/${PP_SESSION_ID}/commands" \
                -H "Authorization: Bearer ${PP_TOKEN}" \
                -H "Content-Type: application/json" \
                -d "{
                    \"command\": ${json_cmd},
                    \"output\": ${json_output},
                    \"exit_code\": ${exit_code},
                    \"cwd\": ${json_cwd},
                    \"duration_ms\": ${duration}
                }" >/dev/null 2>&1
        } &!
    else
        (
            curl -s -X POST "${PP_API_URL}/terminal/sessions/${PP_SESSION_ID}/commands" \
                -H "Authorization: Bearer ${PP_TOKEN}" \
                -H "Content-Type: application/json" \
                -d "{
                    \"command\": ${json_cmd},
                    \"output\": ${json_output},
                    \"exit_code\": ${exit_code},
                    \"cwd\": ${json_cwd},
                    \"duration_ms\": ${duration}
                }" >/dev/null 2>&1
        ) &
        disown 2>/dev/null
    fi

    # Clear state
    _PP_CMD=""
    _PP_CWD=""
    _PP_START=0
    _PP_BUFFER_LINES=0
    _pwnpilot_write_state "idle"
}

# Install hooks based on shell type
_pwnpilot_install_hooks() {
    if [[ -n "$ZSH_VERSION" ]]; then
        # Zsh: use native preexec and precmd hooks
        autoload -Uz add-zsh-hook
        add-zsh-hook preexec _pwnpilot_preexec
        add-zsh-hook precmd _pwnpilot_postexec
    elif [[ -n "$BASH_VERSION" ]]; then
        # Bash: check for bash-preexec first
        if declare -F preexec_functions >/dev/null 2>&1; then
            preexec_functions+=(_pwnpilot_preexec)
            precmd_functions+=(_pwnpilot_postexec)
        else
            # Fallback: Use DEBUG trap for preexec, PROMPT_COMMAND for postexec
            _PP_ORIG_PROMPT_COMMAND="${PROMPT_COMMAND:-}"
            PROMPT_COMMAND='_pwnpilot_postexec; '"${_PP_ORIG_PROMPT_COMMAND}"

            _PP_PREEXEC_READY=1
            trap '_pwnpilot_debug_trap "$BASH_COMMAND"' DEBUG
        fi
    fi
}

_pwnpilot_debug_trap() {
    # Only for bash fallback
    [[ -z "$_PP_PREEXEC_READY" ]] && return
    [[ "$BASH_COMMAND" == _pwnpilot_* ]] && return
    [[ "$BASH_COMMAND" == "$PROMPT_COMMAND" ]] && return

    _pwnpilot_preexec "$1"
    _PP_PREEXEC_READY=""
}

# Install hooks
_pwnpilot_install_hooks
_pwnpilot_write_state "idle"

# Optional startup banner (disabled by default for clean terminal startup)
if [[ "${PP_HOOK_VERBOSE:-0}" == "1" ]]; then
    echo "[PwnPilot] Command history monitoring enabled"
fi
