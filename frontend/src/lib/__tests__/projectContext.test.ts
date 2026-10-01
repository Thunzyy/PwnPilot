import { describe, expect, it } from "vitest";

import {
  buildProjectContextState,
  importProjectContextFromUrl,
  mergeProjectContextIntoVariables,
} from "../projectContext";

describe("importProjectContextFromUrl", () => {
  it("parses a TryHackMe room URL into project context fields", () => {
    expect(
      importProjectContextFromUrl("https://tryhackme.com/room/adventofcyber3")
    ).toMatchObject({
      platform_name: "TryHackMe",
      platform_content_type: "room",
      platform_target_slug: "adventofcyber3",
      platform_target_name: "Adventofcyber3",
      engagement_kind: "platform_lab",
    });
  });

  it("parses a Hack The Box machine URL into project context fields", () => {
    expect(
      importProjectContextFromUrl("https://app.hackthebox.com/machines/analytics")
    ).toMatchObject({
      platform_name: "Hack The Box",
      platform_content_type: "machine",
      platform_target_slug: "analytics",
      platform_target_name: "Analytics",
      engagement_kind: "platform_lab",
    });
  });

  it("returns a generic platform label for unsupported URLs", () => {
    expect(
      importProjectContextFromUrl("https://portswigger.net/web-security/sql-injection")
    ).toMatchObject({
      platform_name: "Portswigger",
      platform_url: "https://portswigger.net/web-security/sql-injection",
      engagement_kind: "practice",
    });
  });
});

describe("project context variable helpers", () => {
  it("builds form state from project variables", () => {
    expect(
      buildProjectContextState({
        engagement_kind: "ctf",
        platform_name: "Hack The Box",
        platform_url: "https://app.hackthebox.com/machines/analytics",
        platform_target_name: "Analytics",
        target_ip: "10.10.11.55",
        ai_briefing: "Focus on foothold and escalation paths.",
      })
    ).toMatchObject({
      engagement_kind: "ctf",
      platform_name: "Hack The Box",
      platform_target_name: "Analytics",
      target_ip: "10.10.11.55",
      ai_briefing: "Focus on foothold and escalation paths.",
    });
  });

  it("merges form state into project variables and removes empty context fields", () => {
    expect(
      mergeProjectContextIntoVariables(
        {
          engagement_kind: "platform_lab",
          platform_name: "TryHackMe",
          platform_url: "",
          platform_content_type: "",
          platform_target_name: "Advent of Cyber 3",
          platform_target_slug: "adventofcyber3",
          platform_difficulty: "",
          target_ip: "",
          target_domain: "",
          os: "",
          scope: "",
          objective: "",
          constraints: "",
          notes: "",
          ai_briefing: "Room walkthrough with manual overrides.",
        },
        {
          existing_key: "keep-me",
          platform_url: "https://old.example",
        }
      )
    ).toEqual({
      existing_key: "keep-me",
      engagement_kind: "platform_lab",
      platform_name: "TryHackMe",
      platform_target_name: "Advent of Cyber 3",
      platform_target_slug: "adventofcyber3",
      ai_briefing: "Room walkthrough with manual overrides.",
    });
  });
});
