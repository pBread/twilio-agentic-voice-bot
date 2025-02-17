import type { RequestTool, ToolDefinition } from "../../agents/tools.js";
import { getMakeLogger, type StopwatchLogger } from "../../lib/logger.js";
import type { SessionStore } from "../session-store/index.js";
import type { ConversationRelayAdapter } from "../twilio/conversation-relay-adapter.js";
import type {
  AgentResolverConfig,
  IAgentResolver,
  LLMConfig,
  ToolResponse,
} from "./types.js";

export class AgentResolver implements IAgentResolver {
  private log: StopwatchLogger;

  // allows the app to check if the resolver configurations have been set properly
  private readyResolver!: (value: true) => void;
  public readyPromise: Promise<true>;
  public ready = false;

  public llmConfig?: LLMConfig; // must be set before the first method is called
  public instructionsTemplate?: string; // must be set before the first method is called
  private toolMap: Map<string, ToolDefinition>; // tool manifest is stored in a map to avoid accidental conflicts

  constructor(
    protected readonly relay: ConversationRelayAdapter,
    protected readonly store: SessionStore,
    config?: Partial<AgentResolverConfig>,
  ) {
    this.readyPromise = new Promise<true>((resolve) => {
      this.readyResolver = resolve;
    });

    this.log = getMakeLogger(store.callSid);
    this.toolMap = new Map();

    this.instructionsTemplate = config?.instructionsTemplate;
    this.llmConfig = config?.llmConfig;

    if (config?.toolManifest)
      config?.toolManifest.forEach((tool) => this.setTool(tool));
  }

  // note: configure() only adds tools to the manifest. To remove tools you must call removeTool
  configure = (config: Partial<AgentResolverConfig>) => {
    const configKeys = [
      "instructionsTemplate",
      "llmConfig",
      "toolManifest",
    ] as (keyof AgentResolverConfig)[];
    const keys = Object.keys(config)
      .filter((key) => configKeys.includes(key as keyof AgentResolverConfig))
      .join(", ");

    this.log.info("resolver", `configurating agent resolver: ${keys}`);

    const { instructionsTemplate, llmConfig, toolManifest } = config;
    this.instructionsTemplate =
      instructionsTemplate ?? this.instructionsTemplate;
    this.llmConfig = llmConfig ?? this.llmConfig;
    if (toolManifest) for (const tool of toolManifest) this.setTool(tool);
  };

  // instructions
  getInstructions = (): string => {
    this.assertReady();

    return this.instructionTemplate;
  };

  // config
  getLLMConfig = (): LLMConfig => {
    this.assertReady();
    return this.llmConfig;
  };

  // tools
  getToolManifest = (): ToolDefinition<any>[] => {
    this.assertReady();
    return [...this.toolMap.values()];
  };

  removeTool = (toolName: string) => {
    this.log.info("resolver", `removing tool ${toolName}`);
    return this.toolMap.delete(toolName);
  };

  setTool = (tool: ToolDefinition) => {
    if (this.toolMap.has(tool.name))
      this.log.info("resolver", `overriding tool ${tool.name}`);

    this.toolMap.set(tool.name, tool);
  };

  executeTool = async (
    toolName: string,
    args: string,
  ): Promise<ToolResponse> => {
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      this.log.warn(
        "agent",
        `LLM attempted to execute a tool (${toolName}) that does not exist.`,
      );
      return { status: "error", error: `Tool ${toolName} does not exist.` };
    }

    // sometimes the bot will try to execute a tool it previously had executed even if the tool is no longer in the tool manifest.
    const isToolAvailable = this.getToolManifest().some(
      (tool) => toolName === tool.name,
    );
    if (!isToolAvailable) {
      this.log.warn(
        "agent",
        `LLM attempted to execute a tool (${toolName}) that it is not authorized to use.`,
      );
      return {
        status: "error",
        error: `Tool ${toolName} exists, but it has not been authorized to be executed.`,
      };
    }

    if (tool.type === "request") {
      const result = await executeRequestTool(tool, args);
      return result;
    }

    return { status: "error", error: "unknown" };
  };

  /****************************************************
   Misc Utilities
  ****************************************************/
  private assertReady: () => asserts this is this & {
    instructionTemplate: string;
    llmConfig: LLMConfig;
  } = () => {
    if (!this.instructionsTemplate || !this.llmConfig) {
      const msg = `Agent params or config are not defined. Check your initialization of the AgentResolver to ensure the parameters & model config are set before any class methods are executed.`;
      this.log.error("resolver", msg, {
        instructionsTemplate: this.instructionsTemplate,
        llmConfig: this.llmConfig,
        toolManifest: this.toolMap.values(),
      });
      throw new Error(msg);
    }

    if (!this.ready) return;

    this.ready = true;
    this.readyResolver(true);
  };
}

// todo: make this interchangable
async function executeRequestTool(
  tool: RequestTool,
  args?: string,
): Promise<ToolResponse> {
  return fetch(tool.endpoint.url, {
    method: tool.endpoint.method,
    body: args,
  })
    .then(
      async (res) =>
        ({
          status: "success",
          data: await res.json(),
        }) as ToolResponse,
    )
    .catch((error) => ({ status: "error", error }));
}
