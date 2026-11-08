// One agent cycle (agent.md 5.2): system prompt plus one wake packet, budgeted model requests,
// tool calls through dispatch.ts, step and tool-call limits, the cycle deadline, the JSON mode
// path through parse.ts (one correction, then the fallback), and a cycle_summary action.

import type { CycleCtx } from "./agent-types.ts";
import { toolModeFor } from "./config.ts";
import { redactNames } from "./guards.ts";
import { modelExtras } from "./llm/client.ts";
import { parseReply, stripThink } from "./llm/parse.ts";
import type { ChatMessage, ToolCall } from "./llm/types.ts";
import { clip, dispatch, logAction, type ToolResult } from "./tools/dispatch.ts";
import { jsonCatalog, toolDefs } from "./tools/schemas.ts";
import { safeJson } from "./log.ts";

export const CORRECTION = "Reply with one JSON object only.";
const TOOL_RESULT_MAX = 4000;
const JSON_MAX_ACTIONS = 3;

function toolMessage(r: ToolResult): string {
  return clip(safeJson(r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error }), TOOL_RESULT_MAX);
}

/** Runs the model part of the cycle. Returns null on a clean finish, or why the model path failed. */
async function modelLoop(ctx: CycleCtx): Promise<string | null> {
  const { agent, deps, world, input } = ctx;
  const mode = toolModeFor(deps.cfg, agent.model);
  const system = mode === "json" ? `${agent.systemPrompt}\n\n${jsonCatalog(agent.tools)}` : agent.systemPrompt;
  const packet = redactNames(agent.buildWakePacket(world, input, ctx), world);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: packet },
  ];
  deps.log.debug(agent.name, `packet:\n${packet}`);
  deps.log.traceLine({ agent: agent.name, event: "wake", chain_id: input.chainId, wakes: input.wakes.map((w) => w.note), packet });
  let parseFailures = 0;

  for (let step = 1; step <= agent.maxSteps; step++) {
    ctx.state.step = step;
    if (deps.clock.now() >= input.deadlineAt) return "cycle deadline reached";
    let reply;
    try {
      reply = await deps.llm.chat(
        {
          agent: agent.name,
          model: agent.model,
          messages,
          tools: mode === "native" ? toolDefs(agent.tools) : undefined,
          maxTokens: agent.maxTokens,
          timeoutMs: agent.timeoutMs,
          extra: modelExtras(deps.cfg, agent.model),
        },
        { priority: input.priority, deadlineAt: input.deadlineAt },
      );
    } catch (err) {
      return `model request failed: ${(err as Error).message}`;
    }
    deps.log.traceLine({
      agent: agent.name,
      event: "model_reply",
      model: agent.model,
      step,
      chain_id: input.chainId,
      status: reply.status,
      latency_ms: reply.latencyMs,
      content: clip(reply.content, 2000),
      tool_calls: reply.toolCalls.map((t) => t.function.name),
      reasoning: reply.reasoning,
    });
    const content = stripThink(reply.content);

    if (mode === "native") {
      let calls: ToolCall[] = reply.toolCalls;
      if (calls.length === 0) {
        // NIM can put a tool call in content when its parser fails (agent.md 4.2).
        const leaked = parseReply(content);
        if (leaked.kind === "actions") {
          calls = leaked.actions.map((a, i) => ({
            id: `leak_${step}_${i}`,
            type: "function",
            function: { name: a.tool, arguments: JSON.stringify(a.args) },
          }));
        } else {
          ctx.state.summary = leaked.kind === "done" && leaked.summary ? leaked.summary : clip(content.replace(/\s+/g, " "), 140);
          return null;
        }
      }
      messages.push({ role: "assistant", content: content || null, tool_calls: calls });
      for (const call of calls) {
        const r = await dispatch(ctx, call.function.name, call.function.arguments, agent.model);
        messages.push({ role: "tool", tool_call_id: call.id, content: toolMessage(r) });
      }
    } else {
      const parsed = parseReply(reply.content);
      if (parsed.kind === "error") {
        parseFailures++;
        deps.log.warn(agent.name, `JSON reply did not parse (${parsed.error})`);
        if (parseFailures >= 2) return `JSON reply did not parse twice: ${parsed.error}`;
        messages.push({ role: "assistant", content: reply.content });
        messages.push({ role: "user", content: CORRECTION });
        continue;
      }
      if (parsed.kind === "done") {
        ctx.state.summary = parsed.summary || "done";
        return null;
      }
      messages.push({ role: "assistant", content: reply.content });
      const results: Array<Record<string, unknown>> = [];
      for (const a of parsed.actions.slice(0, JSON_MAX_ACTIONS)) {
        const r = await dispatch(ctx, a.tool, a.args, agent.model);
        results.push(r.ok ? { tool: a.tool, ok: true, result: r.result } : { tool: a.tool, ok: false, result: r.error });
      }
      messages.push({ role: "user", content: clip("TOOL_RESULTS " + safeJson(results), TOOL_RESULT_MAX) });
    }
    // Our addition: once the job is done (briefing sent, review submitted), skip the summary request.
    if (agent.finished?.(ctx)) {
      ctx.state.summary = ctx.state.summary || "job done";
      return null;
    }
    if (deps.clock.now() >= input.deadlineAt) return "cycle deadline reached";
  }
  ctx.state.summary = ctx.state.summary || "step limit reached";
  return null;
}

/** Run the agent's fallback with the step reset, logging any failure. */
export async function runFallback(ctx: CycleCtx, why: string): Promise<void> {
  ctx.state.usedFallback = true;
  ctx.state.toolCalls = 0;
  ctx.state.model = "rules";
  try {
    await ctx.agent.fallback(ctx, why);
  } catch (err) {
    ctx.deps.log.error(ctx.agent.name, `fallback failed: ${(err as Error).message}`);
  }
}

export async function runCycle(ctx: CycleCtx): Promise<void> {
  const { agent, deps } = ctx;
  let failure: string | null = null;
  if (ctx.input.stale) failure = "stale task (open over 120 s)";
  else if (!agent.useModel(ctx)) failure = "model not used for this wake";
  else if (deps.llm.health.isDown(agent.model)) failure = `model ${agent.model} is down`;
  else failure = await modelLoop(ctx);

  if (!failure && agent.afterModel) {
    try {
      await agent.afterModel(ctx);
    } catch (err) {
      deps.log.error(agent.name, `afterModel failed: ${(err as Error).message}`);
    }
  }
  if (failure || !agent.satisfied(ctx)) {
    const why = failure ?? "model finished without doing the task";
    deps.log.info(agent.name, `fallback: ${why}`);
    await runFallback(ctx, why);
  }
  // A claimed task never stays claimed after a cycle.
  if (ctx.input.task && !ctx.state.taskCompleted) {
    try {
      await ctx.board.complete(ctx.input.task.id, ctx.state.usedFallback ? "failed" : "done", {
        summary: ctx.state.summary || failure || "no result",
        fallback: ctx.state.usedFallback,
        ...(ctx.input.stale ? { stale: true } : {}),
      });
      ctx.state.taskCompleted = true;
    } catch (err) {
      deps.log.error(agent.name, `complete_agent_task failed: ${(err as Error).message}`);
    }
  }
  const summary = ctx.state.summary || (failure ? `[fallback] ${failure}` : "done");
  await logAction(
    ctx,
    "cycle_summary",
    { wakes: ctx.input.wakes.map((w) => w.key), task_id: ctx.input.task?.id ?? null },
    clip(`ok: ${summary}`, 300),
    clip(summary, 140),
    ctx.state.usedFallback ? "rules" : agent.model,
  );
}
