// Tool JSON schemas from agent.md 7.1 to 7.4: one source for native tool calls and the
// strict JSON action format (agent.md 4.4).

export type ToolName =
  | "get_board"
  | "get_survivor"
  | "list_rescuers"
  | "list_cells"
  | "get_robot"
  | "propose_assignment"
  | "delegate"
  | "set_flag_status"
  | "create_mission"
  | "cancel_own_mission"
  | "send_briefing"
  | "submit_review";
// Extension points (could have, E10): "sitrep", "describe_still".

export interface ToolSchema {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  write: boolean;
}

const reason = { type: "string", minLength: 3, maxLength: 140 };

export const SCHEMAS: Record<ToolName, ToolSchema> = {
  get_board: {
    name: "get_board",
    write: false,
    description:
      "Read the board: counts by tier and status, the top 5 survivors, rescuers with availability, cells by status, robots, and open audit flags.",
    parameters: { type: "object", properties: { reason }, required: ["reason"], additionalProperties: false },
  },
  get_survivor: {
    name: "get_survivor",
    write: false,
    description: "Read one survivor with its tier, rank, detections, cell counts, assignments, and display string.",
    parameters: {
      type: "object",
      properties: { reason, survivor_id: { type: "integer", minimum: 1 } },
      required: ["reason", "survivor_id"],
      additionalProperties: false,
    },
  },
  list_rescuers: {
    name: "list_rescuers",
    write: false,
    description:
      "List rescuers by callsign with identity, fresh, available, free, active_assignments, and with near_survivor_id the distance, bearing, and compass word.",
    parameters: {
      type: "object",
      properties: {
        reason,
        near_survivor_id: { type: "integer", minimum: 1 },
        only_available: { type: "boolean", default: true },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  list_cells: {
    name: "list_cells",
    write: false,
    description:
      "List search cells (default unsearched and partially_searched), cells with people unaccounted for first, then by distance.",
    parameters: {
      type: "object",
      properties: {
        reason,
        statuses: {
          type: "array",
          items: { enum: ["unsearched", "searching", "partially_searched", "searched"] },
          uniqueItems: true,
        },
        near_robot_id: { type: "string", minLength: 1, maxLength: 32 },
        include_targeted: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 30, default: 10 },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  get_robot: {
    name: "get_robot",
    write: false,
    description: "Read one robot with its latest terrain, idle flag, seconds since heartbeat, devices, and missions.",
    parameters: {
      type: "object",
      properties: { reason, robot_id: { type: "string", minLength: 1, maxLength: 32 } },
      required: ["reason", "robot_id"],
      additionalProperties: false,
    },
  },
  propose_assignment: {
    name: "propose_assignment",
    write: true,
    description: "Propose a rescuer (by identity hex) for an unassigned survivor. The rescuer acknowledges on the glasses.",
    parameters: {
      type: "object",
      properties: {
        reason,
        survivor_id: { type: "integer", minimum: 1 },
        rescuer_identity: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
      },
      required: ["reason", "survivor_id", "rescuer_identity"],
      additionalProperties: false,
    },
  },
  delegate: {
    name: "delegate",
    write: true,
    description: "Post a brief_rescuer task to the comms agent for a proposal.",
    parameters: {
      type: "object",
      properties: {
        reason,
        to_agent: { enum: ["comms_agent"] },
        kind: { enum: ["brief_rescuer"] },
        priority: { enum: ["critical", "high", "normal"] },
        assignment_id: { type: "integer", minimum: 1 },
        survivor_id: { type: "integer", minimum: 1 },
      },
      required: ["reason", "to_agent", "kind", "priority"],
      additionalProperties: false,
    },
  },
  set_flag_status: {
    name: "set_flag_status",
    write: true,
    description: "Mark an open audit flag acted or dismissed, with a reason.",
    parameters: {
      type: "object",
      properties: {
        reason,
        flag_id: { type: "integer", minimum: 1 },
        status: { enum: ["acted", "dismissed"] },
      },
      required: ["reason", "flag_id", "status"],
      additionalProperties: false,
    },
  },
  create_mission: {
    name: "create_mission",
    write: true,
    description:
      "Create a robot mission: search_cells (1 to 3 target_cell_ids), inspect (target_lat, target_lon), return_home or hold (only for low battery or a failed device).",
    parameters: {
      type: "object",
      properties: {
        reason,
        robot_id: { type: "string", minLength: 1, maxLength: 32 },
        kind: { enum: ["search_cells", "inspect", "return_home", "hold"] },
        target_cell_ids: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        },
        target_lat: { type: "number", minimum: -90, maximum: 90 },
        target_lon: { type: "number", minimum: -180, maximum: 180 },
      },
      required: ["reason", "robot_id", "kind"],
      additionalProperties: false,
    },
  },
  cancel_own_mission: {
    name: "cancel_own_mission",
    write: true,
    description: "Cancel a mission you created while it is proposed or queued.",
    parameters: {
      type: "object",
      properties: { reason, mission_id: { type: "integer", minimum: 1 } },
      required: ["reason", "mission_id"],
      additionalProperties: false,
    },
  },
  send_briefing: {
    name: "send_briefing",
    write: true,
    description: "Send one line (at most 120 characters, plain ASCII) to a rescuer's glasses or the dashboard.",
    parameters: {
      type: "object",
      properties: {
        reason,
        audience: { type: "string", description: "all, coordinators, commander, or a rescuer identity hex string" },
        text: { type: "string", minLength: 3, maxLength: 120 },
        priority: { enum: ["info", "warning", "critical"] },
        survivor_id: { type: "integer", minimum: 1 },
      },
      required: ["reason", "audience", "text", "priority"],
      additionalProperties: false,
    },
  },
  submit_review: {
    name: "submit_review",
    write: true,
    description: "Complete the claimed review task with a verdict and a reason that cites at least one fact.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", minLength: 3, maxLength: 200 },
        verdict: { enum: ["agree", "disagree"] },
        flag_kind: {
          enum: ["proposal_disagree", "load_imbalance"],
          description: "only with disagree: proposal_disagree for a wrong rescuer, load_imbalance for an unfair load",
        },
        suggested_action: { type: "string", maxLength: 140 },
      },
      required: ["reason", "verdict"],
      additionalProperties: false,
    },
  },
};

/** OpenAI-style tool definitions for native mode. */
export function toolDefs(names: ToolName[]): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return names.map((n) => ({
    type: "function" as const,
    function: { name: n, description: SCHEMAS[n].description, parameters: SCHEMAS[n].parameters },
  }));
}

/** Extra system prompt section for TOOL_MODE=json (agent.md 4.4). */
export function jsonCatalog(names: ToolName[]): string {
  const lines = [
    "TOOLS (JSON mode). You cannot call tools natively. Use only these tools:",
    ...names.map((n) => `- ${n}: ${SCHEMAS[n].description}\n  schema: ${JSON.stringify(SCHEMAS[n].parameters)}`),
    "",
    "Reply with exactly one JSON object and nothing else, in one of two shapes:",
    '{"actions":[{"tool":"<tool name>","args":{...}}]}',
    '{"done":true,"summary":"<one line>"}',
    'At most 3 actions per reply. Every args object must include "reason".',
  ];
  return lines.join("\n");
}
