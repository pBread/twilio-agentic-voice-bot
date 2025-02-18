import { getToolExecutor } from "../../agent/tools/index.js";
import { executeRequestTool } from "../../agent/tools/request.js";
import type { LLMConfig, ToolResponse, ToolSpec } from "../../agent/types.js";
import { getMakeLogger, StopwatchLogger } from "../../lib/logger.js";
import { interpolateTemplate } from "../../lib/template.js";
import type { SessionStore } from "../session-store/index.js";
import type { ConversationRelayAdapter } from "../twilio/conversation-relay-adapter.js";
import type { AgentResolverConfig, IAgentResolver } from "./types.js";

export class AgentResolver implements IAgentResolver {
  private log: StopwatchLogger;
  protected instructions?: string;
  protected llm?: LLMConfig;
  protected toolMap = new Map<string, ToolSpec>();
  protected fillerPhrases: { primary: string[]; secondary: string[] } = {
    primary: [],
    secondary: [],
  };

  constructor(
    private relay: ConversationRelayAdapter,
    private store: SessionStore,
    config?: Partial<AgentResolverConfig>,
  ) {
    this.log = getMakeLogger(store.callSid);
    if (config) this.configure(config);
  }

  configure = (config: Partial<AgentResolverConfig>) => {
    const { instructions, fillerPhrases, llm, tools } = config;
    this.instructions = instructions ?? this.instructions;
    this.llm = llm ?? this.llm;
    if (tools) for (const tool of tools) this.setTool(tool.name, tool);
    this.fillerPhrases = { ...this.fillerPhrases, ...fillerPhrases };
  };

  /****************************************************
   Intstructions
  ****************************************************/
  getInstructions = (): string => {
    this.assertReady();
    return interpolateTemplate(this.instructions, this.store.context);
  };

  /****************************************************
   LLM Configuration
  ****************************************************/
  getLLMConfig = (): LLMConfig => {
    this.assertReady();
    return this.llm;
  };

  /****************************************************
   Tools
  ****************************************************/
  getTools = (): ToolSpec[] => {
    this.assertReady();
    return [...this.toolMap.values()];
  };

  setTool = (name: string, tool: ToolSpec) => {
    if (this.toolMap.has(tool.name))
      this.log.warn("resolver", `overriding tool ${tool.name}`);
    this.toolMap.set(name, tool);
  };

  executeTool = async (
    toolName: string,
    args?: object,
  ): Promise<ToolResponse> => {
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      const error = `Attempted to execute a tool (${toolName}) that does not exist.`;
      this.log.warn("agent", error);
      return { status: "error", error };
    }

    // Tools can be restricted from the bot's manifest. The bot may believe the tool exists if it previously executed it or if the system instructions reference a tool not in the tool-manifest.
    const isToolAvailable = this.getTools().some(
      (tool) => toolName === tool.name,
    );

    if (!isToolAvailable) {
      const error = `Attempted to execute a tool (${toolName}) that is not authorized.`;
      this.log.warn("agent", error);
      return { status: "error", error };
    }

    const fillerTimer = setTimeout(() => {}, 500); // say filler phrase after 500ms

    const resultPromise = await this.executeToolHandler(tool, args);

    clearTimeout(fillerTimer);
    return resultPromise;
  };

  private executeToolHandler = async (
    tool: ToolSpec,
    args: any,
  ): Promise<ToolResponse> => {
    if (tool.type === "request") {
      try {
        return {
          status: "complete",
          result: await executeRequestTool(tool, args),
        };
      } catch (error) {
        return { status: "error", error: `${error}` };
      }
    }

    if (tool.type === "function") {
      const exec = getToolExecutor(tool.name);
      if (!exec) {
        const error = `No executor found for ${tool.name}`;
        this.log.error("resolver", error);
        return { status: "error", error };
      }

      try {
        return {
          status: "complete",
          result: await exec(args, {
            agent: this,
            relay: this.relay,
            store: this.store,
          }),
        };
      } catch (error) {
        return { status: "error", error: `${error}` };
      }
    }

    return { status: "error", error: "Unknown tool type" };
  };

  private makeFillerPhraseTimer = (tool: ToolSpec, args: object) => {
    const primary = setTimeout(() => {
      const phrases = tool?.fillers?.length // use the tools filler phrases if they are defined
        ? tool.fillers
        : this.fillerPhrases?.primary?.length
          ? this.fillerPhrases.primary
          : [];

      this.pickAndSayPhrase(phrases);
    }, 500);

    const secondary = setTimeout(() => {
      this.pickAndSayPhrase(this.fillerPhrases?.secondary ?? []);
    }, 4000);

    return () => {
      clearTimeout(primary);
      clearTimeout(secondary);
    };
  };

  private pickAndSayPhrase = (phrases: string[]) => {
    const template = phrases[Math.floor(Math.random() * phrases.length)];
    if (!template) return;
    return interpolateTemplate(template, this.store.context);
  };

  /****************************************************
   Misc Utilities
  ****************************************************/
  private assertReady: () => asserts this is this & {
    instructions: string;
    llm: LLMConfig;
  } = () => {
    if (!this.instructions || !this.llm) {
      const msg = `Agent params or config are not defined. Check your initialization of the AgentResolver to ensure the parameters & model config are set before any class methods are executed.`;
      this.log.error("resolver", msg, {
        instructions: this.instructions,
        llm: this.llm,
        toolManifest: this.toolMap.values(),
      });
      throw new Error(msg);
    }
  };
}
