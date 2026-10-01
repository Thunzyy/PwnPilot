from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from html import escape
from io import BytesIO
from math import atan2, cos, sin
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont

from app.schemas.graph import GraphEdge, GraphNode, GraphResponse

_PHASE_ORDER = [
    "Enumeration",
    "Credential Access",
    "Foothold",
    "Lateral Movement",
    "Privilege Escalation",
    "Loot / Objectives",
    "Other",
]
_NODE_WIDTH = 224
_NODE_HEIGHT = 76
_LANE_WIDTH = 300
_ROW_HEIGHT = 122
_MARGIN_X = 56
_MARGIN_Y = 86
_HEADER_HEIGHT = 42

_NODE_COLORS = {
    "host": ("#083344", "#22d3ee"),
    "service": ("#0c4a6e", "#38bdf8"),
    "credential": ("#451a03", "#fbbf24"),
    "session": ("#064e3b", "#34d399"),
    "finding": ("#4c0519", "#fb7185"),
    "loot": ("#172554", "#818cf8"),
    "user": ("#312e81", "#a78bfa"),
    "action": ("#111827", "#cbd5e1"),
    "artifact": ("#164e63", "#67e8f9"),
}

_OBJECTIVE_TERMS = ("flag", "root.txt", "user.txt", "loot", "proof", "objective")
_PRIVESC_TERMS = (
    "privesc",
    "privilege escalation",
    "cap_setuid",
    "sudo",
    "setuid",
    "linpeas",
    "getcap",
    "root shell",
    "root@",
)
_LATERAL_TERMS = ("pivot", "lateral", "rdesktop", "smb", "winrm", "rdp", "psexec")


@dataclass(frozen=True, slots=True)
class _PlacedNode:
    node: GraphNode
    phase: str
    x: int
    y: int


@dataclass(frozen=True, slots=True)
class _GraphLayout:
    edges: list[GraphEdge]
    grouped_nodes: dict[str, list[GraphNode]]
    phases: list[str]
    placed_nodes: dict[str, _PlacedNode]
    width: int
    height: int


def render_attack_graph_svg(graph: GraphResponse, *, title: str = "Attack Graph") -> str:
    layout = _layout_graph(graph)
    graph_body = (
        _render_edges(layout.edges, layout.placed_nodes)
        + "\n"
        + _render_lanes(layout.phases, layout.grouped_nodes, layout.height)
        + "\n"
        + _render_nodes(layout.placed_nodes.values())
    )

    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{layout.width}" height="{layout.height}" viewBox="0 0 {layout.width} {layout.height}" role="img" aria-label="{escape(title)}">',
            "  <defs>",
            '    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">',
            '      <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />',
            "    </marker>",
            "  </defs>",
            f'  <rect width="{layout.width}" height="{layout.height}" rx="24" fill="#08111f" />',
            '  <g opacity="0.3">',
            _render_grid(layout.width, layout.height),
            "  </g>",
            f'  <text x="{_MARGIN_X}" y="42" fill="#e2e8f0" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="800">{escape(title)}</text>',
            graph_body,
            "</svg>",
        ]
    )


def render_attack_graph_png(graph: GraphResponse, *, title: str = "Attack Graph") -> bytes:
    layout = _layout_graph(graph)
    image = Image.new("RGB", (layout.width, layout.height), "#08111f")
    draw = ImageDraw.Draw(image)
    fonts = _load_fonts()

    _draw_png_grid(draw, layout.width, layout.height)
    draw.text((_MARGIN_X, 18), title, fill="#e2e8f0", font=fonts["title"])
    _draw_png_lanes(draw, layout.phases, layout.grouped_nodes, layout.height, fonts)
    _draw_png_edges(draw, layout.edges, layout.placed_nodes, fonts)
    _draw_png_nodes(draw, layout.placed_nodes.values(), fonts)

    output = BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def _layout_graph(graph: GraphResponse) -> _GraphLayout:
    nodes = sorted(graph.nodes, key=lambda node: (node.sequence_index, node.id))
    edges = sorted(graph.edges, key=lambda edge: (edge.sequence_index, edge.id))
    grouped_nodes = _group_nodes_by_phase(nodes)
    phases = [phase for phase in _PHASE_ORDER if grouped_nodes.get(phase)]
    if not phases:
        phases = ["Other"]

    placed_nodes: dict[str, _PlacedNode] = {}
    for phase_index, phase in enumerate(phases):
        for row_index, node in enumerate(grouped_nodes.get(phase, [])):
            placed_nodes[node.id] = _PlacedNode(
                node=node,
                phase=phase,
                x=_MARGIN_X + phase_index * _LANE_WIDTH,
                y=_MARGIN_Y + _HEADER_HEIGHT + row_index * _ROW_HEIGHT,
            )

    max_rows = max((len(grouped_nodes.get(phase, [])) for phase in phases), default=1)
    width = _MARGIN_X * 2 + len(phases) * _LANE_WIDTH - (_LANE_WIDTH - _NODE_WIDTH)
    height = _MARGIN_Y * 2 + _HEADER_HEIGHT + max_rows * _ROW_HEIGHT

    return _GraphLayout(
        edges=edges,
        grouped_nodes=grouped_nodes,
        phases=phases,
        placed_nodes=placed_nodes,
        width=width,
        height=height,
    )


def _group_nodes_by_phase(nodes: list[GraphNode]) -> dict[str, list[GraphNode]]:
    grouped: dict[str, list[GraphNode]] = {phase: [] for phase in _PHASE_ORDER}
    for node in nodes:
        grouped[_infer_phase(node)].append(node)
    return grouped


def _infer_phase(node: GraphNode) -> str:
    text = _node_search_text(node)
    privilege = str(node.meta.get("privilege", "")).lower().strip()

    if _includes_any(text, _PRIVESC_TERMS) or privilege in {
        "root",
        "system",
        "administrator",
    }:
        return "Privilege Escalation"
    if _includes_any(text, _LATERAL_TERMS):
        return "Lateral Movement"
    if node.type in {"credential", "user"}:
        return "Credential Access"
    if node.type == "session":
        return "Foothold"
    if node.type in {"host", "service"}:
        return "Enumeration"
    if node.type == "loot" or _includes_any(text, _OBJECTIVE_TERMS):
        return "Loot / Objectives"
    if node.type == "finding":
        return "Privilege Escalation" if str(node.meta.get("severity", "")).lower() == "high" else "Enumeration"
    if node.type == "action":
        return "Enumeration" if _includes_any(text, ("nmap", "ffuf", "gobuster", "enum", "whatweb")) else "Other"
    return "Other"


def _node_search_text(node: GraphNode) -> str:
    meta_values = " ".join(str(value) for value in node.meta.values())
    return " ".join(
        [
            node.label,
            node.notes or "",
            " ".join(node.tags),
            meta_values,
        ]
    ).lower()


def _includes_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _render_grid(width: int, height: int) -> str:
    lines = []
    for x in range(0, width + 1, 24):
        lines.append(f'    <path d="M{x} 0 V{height}" stroke="#1e293b" stroke-width="1" />')
    for y in range(0, height + 1, 24):
        lines.append(f'    <path d="M0 {y} H{width}" stroke="#1e293b" stroke-width="1" />')
    return "\n".join(lines)


def _render_lanes(
    phases: list[str],
    grouped_nodes: dict[str, list[GraphNode]],
    height: int,
) -> str:
    parts = ['  <g id="phases">']
    for phase_index, phase in enumerate(phases):
        x = _MARGIN_X + phase_index * _LANE_WIDTH
        count = len(grouped_nodes.get(phase, []))
        parts.extend(
            [
                f'    <rect x="{x - 14}" y="{_MARGIN_Y}" width="{_NODE_WIDTH + 28}" height="{height - _MARGIN_Y * 1.35:.0f}" rx="18" fill="#0f172a" opacity="0.42" stroke="#1e293b" />',
                f'    <text x="{x}" y="{_MARGIN_Y + 20}" fill="#67e8f9" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="800" letter-spacing="1.4">{escape(phase.upper())}</text>',
                f'    <text x="{x}" y="{_MARGIN_Y + 38}" fill="#64748b" font-family="Inter, Arial, sans-serif" font-size="11">{count} node{"s" if count != 1 else ""}</text>',
            ]
        )
    parts.append("  </g>")
    return "\n".join(parts)


def _render_edges(
    edges: list[GraphEdge],
    placed_nodes: dict[str, _PlacedNode],
) -> str:
    parts = ['  <g id="edges" fill="none" font-family="Inter, Arial, sans-serif">']
    for edge in edges:
        source = placed_nodes.get(edge.source_id)
        target = placed_nodes.get(edge.target_id)
        if not source or not target:
            continue
        label = _edge_label(edge)
        if edge.source_id == edge.target_id:
            sx = source.x + _NODE_WIDTH + 6
            sy = source.y + 22
            parts.extend(
                [
                    f'    <path d="M{sx} {sy} C{sx + 56} {sy - 28}, {sx + 56} {sy + 58}, {sx} {sy + 32}" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)" opacity="0.9" />',
                    f'    <text x="{sx + 18}" y="{sy + 8}" fill="#cbd5e1" font-size="11">{escape(label)}</text>',
                ]
            )
            continue

        sx = source.x + _NODE_WIDTH
        sy = source.y + _NODE_HEIGHT / 2
        tx = target.x
        ty = target.y + _NODE_HEIGHT / 2
        midpoint_x = (sx + tx) / 2
        midpoint_y = (sy + ty) / 2 - 8
        parts.extend(
            [
                f'    <path d="M{sx:.0f} {sy:.0f} C{midpoint_x:.0f} {sy:.0f}, {midpoint_x:.0f} {ty:.0f}, {tx:.0f} {ty:.0f}" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrow)" opacity="0.82" />',
                f'    <text x="{midpoint_x:.0f}" y="{midpoint_y:.0f}" fill="#cbd5e1" font-size="11" text-anchor="middle">{escape(label)}</text>',
            ]
        )
    parts.append("  </g>")
    return "\n".join(parts)


def _render_nodes(nodes: Iterable[_PlacedNode]) -> str:
    parts = ['  <g id="nodes" font-family="Inter, Arial, sans-serif">']
    for placed in sorted(nodes, key=lambda item: (item.x, item.y, item.node.id)):
        fill, stroke = _NODE_COLORS.get(placed.node.type, ("#111827", "#94a3b8"))
        label_lines = wrap(placed.node.label, width=24, max_lines=2, placeholder="...")
        subtitle = placed.node.type.replace("_", " ")
        parts.extend(
            [
                f'    <g id="node-{escape(placed.node.id)}" data-phase="{escape(placed.phase)}">',
                f'      <rect x="{placed.x}" y="{placed.y}" width="{_NODE_WIDTH}" height="{_NODE_HEIGHT}" rx="14" fill="{fill}" stroke="{stroke}" stroke-width="1.6" />',
                f'      <text x="{placed.x + 16}" y="{placed.y + 24}" fill="#f8fafc" font-size="13" font-weight="800">{escape(label_lines[0] if label_lines else placed.node.label)}</text>',
            ]
        )
        if len(label_lines) > 1:
            parts.append(
                f'      <text x="{placed.x + 16}" y="{placed.y + 41}" fill="#e2e8f0" font-size="12" font-weight="700">{escape(label_lines[1])}</text>'
            )
            subtitle_y = placed.y + 60
        else:
            subtitle_y = placed.y + 48
        parts.extend(
            [
                f'      <text x="{placed.x + 16}" y="{subtitle_y}" fill="#cbd5e1" font-size="11">{escape(subtitle)}</text>',
                f'      <text x="{placed.x + _NODE_WIDTH - 14}" y="{placed.y + 24}" fill="{stroke}" font-size="10" font-weight="800" text-anchor="end">{escape(placed.node.created_by)}</text>',
                "    </g>",
            ]
        )
    parts.append("  </g>")
    return "\n".join(parts)


def _load_fonts() -> dict[str, ImageFont.ImageFont]:
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold_font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

    def load(path: str, size: int) -> ImageFont.ImageFont:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            return ImageFont.load_default()

    return {
        "title": load(bold_font_path, 24),
        "phase": load(bold_font_path, 12),
        "meta": load(font_path, 11),
        "node_label": load(bold_font_path, 13),
        "node_label_small": load(bold_font_path, 12),
        "node_subtitle": load(font_path, 11),
        "badge": load(bold_font_path, 10),
        "edge": load(font_path, 11),
    }


def _draw_png_grid(draw: ImageDraw.ImageDraw, width: int, height: int) -> None:
    for x in range(0, width + 1, 24):
        draw.line([(x, 0), (x, height)], fill="#122033", width=1)
    for y in range(0, height + 1, 24):
        draw.line([(0, y), (width, y)], fill="#122033", width=1)


def _draw_png_lanes(
    draw: ImageDraw.ImageDraw,
    phases: list[str],
    grouped_nodes: dict[str, list[GraphNode]],
    height: int,
    fonts: dict[str, ImageFont.ImageFont],
) -> None:
    for phase_index, phase in enumerate(phases):
        x = _MARGIN_X + phase_index * _LANE_WIDTH
        lane_height = int(height - _MARGIN_Y * 1.35)
        count = len(grouped_nodes.get(phase, []))
        draw.rounded_rectangle(
            (x - 14, _MARGIN_Y, x + _NODE_WIDTH + 14, _MARGIN_Y + lane_height),
            radius=18,
            fill="#0b1628",
            outline="#1e293b",
            width=1,
        )
        draw.text((x, _MARGIN_Y + 8), phase.upper(), fill="#67e8f9", font=fonts["phase"])
        draw.text(
            (x, _MARGIN_Y + 26),
            f'{count} node{"s" if count != 1 else ""}',
            fill="#64748b",
            font=fonts["meta"],
        )


def _draw_png_edges(
    draw: ImageDraw.ImageDraw,
    edges: list[GraphEdge],
    placed_nodes: dict[str, _PlacedNode],
    fonts: dict[str, ImageFont.ImageFont],
) -> None:
    for edge in edges:
        source = placed_nodes.get(edge.source_id)
        target = placed_nodes.get(edge.target_id)
        if not source or not target:
            continue

        label = _edge_label(edge)
        if edge.source_id == edge.target_id:
            sx = source.x + _NODE_WIDTH + 6
            sy = source.y + 22
            points = [
                (sx, sy),
                (sx + 44, sy - 20),
                (sx + 56, sy + 18),
                (sx, sy + 32),
            ]
            _draw_polyline_with_arrow(draw, points, fill="#64748b")
            draw.text((sx + 18, sy + 1), label, fill="#cbd5e1", font=fonts["edge"])
            continue

        sx = source.x + _NODE_WIDTH
        sy = source.y + _NODE_HEIGHT // 2
        tx = target.x
        ty = target.y + _NODE_HEIGHT // 2
        midpoint_x = int((sx + tx) / 2)
        points = [(sx, sy), (midpoint_x, sy), (midpoint_x, ty), (tx, ty)]
        _draw_polyline_with_arrow(draw, points, fill="#94a3b8")
        label_width = _text_width(draw, label, fonts["edge"])
        draw.text(
            (midpoint_x - label_width / 2, int((sy + ty) / 2) - 18),
            label,
            fill="#cbd5e1",
            font=fonts["edge"],
        )


def _draw_polyline_with_arrow(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[float, float]],
    *,
    fill: str,
) -> None:
    draw.line(points, fill=fill, width=2, joint="curve")
    if len(points) < 2:
        return

    start_x, start_y = points[-2]
    end_x, end_y = points[-1]
    angle = atan2(end_y - start_y, end_x - start_x)
    arrow_size = 10
    left = (
        end_x - arrow_size * cos(angle - 0.42),
        end_y - arrow_size * sin(angle - 0.42),
    )
    right = (
        end_x - arrow_size * cos(angle + 0.42),
        end_y - arrow_size * sin(angle + 0.42),
    )
    draw.polygon([(end_x, end_y), left, right], fill=fill)


def _draw_png_nodes(
    draw: ImageDraw.ImageDraw,
    nodes: Iterable[_PlacedNode],
    fonts: dict[str, ImageFont.ImageFont],
) -> None:
    for placed in sorted(nodes, key=lambda item: (item.x, item.y, item.node.id)):
        fill, stroke = _NODE_COLORS.get(placed.node.type, ("#111827", "#94a3b8"))
        x1 = placed.x
        y1 = placed.y
        x2 = placed.x + _NODE_WIDTH
        y2 = placed.y + _NODE_HEIGHT
        draw.rounded_rectangle(
            (x1, y1, x2, y2),
            radius=14,
            fill=fill,
            outline=stroke,
            width=2,
        )

        label_lines = wrap(placed.node.label, width=24, max_lines=2, placeholder="...")
        first_line = label_lines[0] if label_lines else placed.node.label
        draw.text((x1 + 16, y1 + 12), first_line, fill="#f8fafc", font=fonts["node_label"])
        if len(label_lines) > 1:
            draw.text(
                (x1 + 16, y1 + 29),
                label_lines[1],
                fill="#e2e8f0",
                font=fonts["node_label_small"],
            )
            subtitle_y = y1 + 49
        else:
            subtitle_y = y1 + 36

        subtitle = placed.node.type.replace("_", " ")
        draw.text((x1 + 16, subtitle_y), subtitle, fill="#cbd5e1", font=fonts["node_subtitle"])
        badge = placed.node.created_by
        badge_width = _text_width(draw, badge, fonts["badge"])
        draw.text(
            (x2 - 14 - badge_width, y1 + 12),
            badge,
            fill=stroke,
            font=fonts["badge"],
        )


def _text_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
) -> int:
    left, _top, right, _bottom = draw.textbbox((0, 0), text, font=font)
    return right - left


def _edge_label(edge: GraphEdge) -> str:
    return edge.label or edge.kind.replace("_", " ")
