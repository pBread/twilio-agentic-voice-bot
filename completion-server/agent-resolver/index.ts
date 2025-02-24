import { getToolExecutor } from "../../agent/tools/index.js";
import type {
  LLMConfig,
  ToolDependencies,
  ToolResponse,
  ToolSpec,
} from "../../agent/types.js";
import { getMakeLogger } from "../../lib/logger.js";
import { createRoundRobinPicker } from "../../lib/round-robin-picker.js";
import { chunkIntoSentences } from "../../lib/strings.js";
import { interpolateTemplate } from "../../lib/template.js";
import type { BotToolTurn } from "../../shared/session/turns.js";
import type { SessionStore } from "../session-store/index.js";
import type { ConversationRelayAdapter } from "../twilio/conversation-relay.js";
import type { AgentResolverConfig, IAgentResolver } from "./types.js";

export class AgentResolver implements IAgentResolver {
  private log: ReturnType<typeof getMakeLogger>;
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
    this.phrasePicker = createRoundRobinPicker();
  }

  configure = (config: Partial<AgentResolverConfig>) => {
    const { instructions, fillerPhrases, llmConfig, toolManifest } = config;
    this.instructions = instructions ?? this.instructions;
    this.llm = llmConfig ?? this.llm;
    if (toolManifest)
      for (const tool of toolManifest) this.setTool(tool.name, tool);
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
    const toolConfig = this.store.context.toolConfig ?? {};

    return [...this.toolMap.values()].filter((tool) => {
      if (tool.name in toolConfig) return !toolConfig[tool.name].restricted;

      return true;
    });
  };

  setTool = (name: string, tool: ToolSpec) => {
    if (this.toolMap.has(tool.name))
      this.log.warn("resolver", `overriding tool ${tool.name}`);
    this.toolMap.set(name, tool);
  };

  getToolSpec = (toolName: string) => {
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      const error = `Attempted to execute a tool (${toolName}) that does not exist.`;
      this.log.warn("agent", error);
      return error;
    }

    // Tools can be restricted from the bot's manifest. The bot may believe the tool exists if it previously executed it or if the system instructions reference a tool not in the tool-manifest.
    const isToolAvailable = this.getTools().some(
      (tool) => toolName === tool.name,
    );

    if (!isToolAvailable) {
      const error = `Attempted to execute a tool (${toolName}) that is not authorized.`;
      this.log.warn("agent", error);
      return error;
    }

    return tool;
  };

  executeTool = async (
    turnId: string,
    toolName: string,
    args?: object,
  ): Promise<ToolResponse> => {
    const tool = this.getToolSpec(toolName);
    if (typeof tool == "string") return { status: "error", error: tool }; // tool not found

    const cancelFillerPhrase = this.makeFillerPhraseTimer(turnId, tool, args);

    const resultPromise = await this.executeToolHandler(tool, args);

    this.clearFillerPhraseTimers();
    return resultPromise;
  };

  private executeToolHandler = async (
    tool: ToolSpec,
    args: any,
  ): Promise<ToolResponse> => {
    if (tool.type === "function") {
      const exec = getToolExecutor(tool.name);
      if (!exec) {
        const error = `No executor found for ${tool.name}`;
        this.log.error("resolver", error);
        return { status: "error", error };
      }

      try {
        const deps: ToolDependencies = {
          agent: this,
          log: this.log,
          relay: this.relay,
          store: this.store,
        };

        return {
          status: "complete",
          result: await exec(args, deps),
        };
      } catch (error) {
        return { status: "error", error: `${error}` };
      }
    }

    this.log.warn("resolver", "unknown tool type: ", tool);
    return { status: "error", error: "Unknown tool type" };
  };

  private phrasePicker: ReturnType<typeof createRoundRobinPicker>;

  private fillerTimeout1: NodeJS.Timeout | undefined;
  private fillerTimeout2: NodeJS.Timeout | undefined;
  public queueFillerPhrase = (
    turnId: string,
    toolName: string,
    args?: object,
  ) => {
    const tool = this.getToolSpec(toolName);
    if (typeof tool === "string") return; // tool not found

    this.makeFillerPhraseTimer(turnId, tool, args);
  };

  private makeFillerPhraseTimer = (
    turnId: string,
    tool: ToolSpec,
    args: object = {},
  ) => {
    if (!this.fillerTimeout1)
      this.fillerTimeout1 = setTimeout(() => {
        const turn = this.store.turns.get(turnId) as BotToolTurn | undefined;
        if (turn?.status === "interrupted") return;
        if (tool.fillers === null) return; // null means no fillers for this tool

        // check when the last filler turn was spoken.
        const [lastFillerTurn] = this.store.turns
          .list()
          .reverse()
          .filter((turn) => turn.origin === "filler");

        if (lastFillerTurn) {
          const createdAt = new Date(lastFillerTurn.createdAt);
          const msSinceLast = new Date().getTime() - createdAt.getTime();

          if (msSinceLast < 5 * 1000) return; // avoid repetition by not speaking fillers within the last few seconds
        }

        const phrases = tool?.fillers?.length // use the tools filler phrases if they are defined
          ? tool.fillers
          : this.fillerPhrases?.primary?.length
          ? this.fillerPhrases.primary
          : [];

        const bestPhrase = this.phrasePicker(phrases);
        this.sayPhrase(bestPhrase, args);
      }, 300);

    if (!this.fillerTimeout2)
      this.fillerTimeout2 = setTimeout(() => {
        const turn = this.store.turns.get(turnId) as BotToolTurn | undefined;
        if (turn?.status === "interrupted") return;
        if (tool.fillers === null) return; // null means no fillers for this tool

        const phrases = this.fillerPhrases?.secondary ?? [];
        const bestPhrase = this.phrasePicker(phrases);
        this.sayPhrase(bestPhrase, args);
      }, 5000);
  };

  clearFillerPhraseTimers = () => {
    clearTimeout(this.fillerTimeout1);
    this.fillerTimeout1 = undefined;
    clearTimeout(this.fillerTimeout2);
    this.fillerTimeout2 = undefined;
  };

  private sayPhrase = (template?: string, args: object = {}) => {
    if (!template?.length) return;
    const phrase = interpolateTemplate(template, {
      ...this.store.context,
      args, // inject the args so the filler phrase can reference them
    });

    const sentences = chunkIntoSentences(phrase); // send in chunks to make interruptions more accurate
    sentences.forEach((sentence, idx) =>
      this.relay.sendTextToken(sentence, idx + 1 === sentences.length),
    );
    this.store.turns.addBotText({
      content: phrase,
      origin: "filler",
      status: "complete",
    });
    this.log.info("agent.filler", `"${phrase.trim()}"`);
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
