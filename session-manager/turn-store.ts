import { makeId } from "../lib/ids";
import { TypedEventEmitter } from "../lib/types";
import {
  BotDTMFTurn,
  BotDTMFTurnParams,
  BotTextTurn,
  BotTextTurnParams,
  BotToolTurn,
  BotToolTurnParams,
  HumanDTMFTurn,
  HumanDTMFTurnParams,
  HumanTextTurn,
  HumanTextTurnParams,
  SystemTurn,
  SystemTurnParams,
  Turn,
} from "./turn-store.entities";

export class TurnStore {
  private callSid: string;
  private turnMap: Map<string, Turn>; // map order enforces turn ordering, not the order property on the turns

  constructor(callSid: string) {
    this.callSid = callSid;
    this.turnMap = new Map();
    this.eventEmitter = new TypedEventEmitter<TurnEvents>();
  }

  /****************************************************
   Events
  ****************************************************/
  private eventEmitter: TypedEventEmitter<TurnEvents>;
  public on: TypedEventEmitter<TurnEvents>["on"] = (...args) =>
    this.eventEmitter.on(...args);

  /****************************************************
   Turn Sequential Ordering
  ****************************************************/
  private _currentOrder: number = 0; // order is a non-sequential incrementor. Each turn is only gauranteed to have an order value greater than the previous. In other words, order is not always exactly +1 greater than the previous.
  // currentOrder cannot be mutated by external methods to protect order sequence
  public get currentOrder() {
    return this._currentOrder;
  }
  private nextOrder = () => this._currentOrder++;

  /****************************************************
   Primitive Methods
  ****************************************************/
  delete = (id: string) => this.turnMap.delete(id);
  get = (id: string) => this.turnMap.get(id);
  list = () => [...this.turnMap.values()];

  /****************************************************
   Turn Record Creators
  ****************************************************/
  addBotDTMF = (params: BotDTMFTurnParams): BotDTMFTurn => {
    const turn = makeBotDTMFTurn(params);
    const emitUpdate = () => {
      turn.version++;
      this.eventEmitter.emit("updatedTurn", turn.id);
    };

    const fullTurn = {
      ...turn,
      callSid: this.callSid,
      order: this.nextOrder(),
      get version() {
        return turn.version;
      },

      get content() {
        return turn.content;
      },
      set content(value: string) {
        turn.content = value;
        emitUpdate();
      },

      get interrupted() {
        return turn.interrupted;
      },
      set interrupted(value: boolean) {
        turn.interrupted = value;
        emitUpdate();
      },
    };

    this.turnMap.set(fullTurn.id, fullTurn);
    return fullTurn;
  };

  addBotText = (params: BotTextTurnParams): BotTextTurn => {
    const turn = makeBotTextTurn(params);
    const emitUpdate = () => {
      turn.version++;
      this.eventEmitter.emit("updatedTurn", turn.id);
    };

    const fullTurn = {
      ...turn,
      callSid: this.callSid,
      order: this.nextOrder(),
      get version() {
        return turn.version;
      },
      get content() {
        return turn.content;
      },
      set content(value: string) {
        turn.content = value;
        emitUpdate();
      },
    };
    this.turnMap.set(fullTurn.id, fullTurn);
    return fullTurn;
  };

  addBotTool = (params: BotToolTurnParams): BotToolTurn => {
    const turn = makeBotToolTurn(params);
    const emitUpdate = () => {
      turn.version++;
      this.eventEmitter.emit("updatedTurn", turn.id);
    };

    const fullTurn = {
      ...turn,
      callSid: this.callSid,
      order: this.nextOrder(),
      get version() {
        return turn.version;
      },
    };
    this.turnMap.set(fullTurn.id, fullTurn);
    return fullTurn;
  };

  addHumanDTMF = (params: HumanDTMFTurnParams): HumanDTMFTurn => {
    const turn = makeHumanDTMFTurn(params);
    const emitUpdate = () => {
      turn.version++;
      this.eventEmitter.emit("updatedTurn", turn.id);
    };

    const fullTurn = {
      ...turn,
      callSid: this.callSid,
      order: this.nextOrder(),
      get version() {
        return turn.version;
      },

      get content() {
        return turn.content;
      },
      set content(content: string) {
        turn.content = content;
        emitUpdate();
      },
    };
    this.turnMap.set(fullTurn.id, fullTurn);
    return fullTurn;
  };

  addHumanText = (params: HumanTextTurnParams): HumanTextTurn => {
    const turn = makeHumanTextTurn(params);
    const emitUpdate = () => {
      turn.version++;
      this.eventEmitter.emit("updatedTurn", turn.id);
    };

    const fullTurn = {
      ...turn,
      callSid: this.callSid,
      order: this.nextOrder(),
      get version() {
        return turn.version;
      },

      get content() {
        return turn.content;
      },
      set content(content: string) {
        turn.content = content;
        emitUpdate();
      },
    };
    this.turnMap.set(fullTurn.id, fullTurn);
    return fullTurn;
  };

  addSystem = (params: SystemTurnParams): SystemTurn => {
    const turn = makeSystemTurn(params);
    const emitUpdate = () => {
      turn.version++;
      this.eventEmitter.emit("updatedTurn", turn.id);
    };

    const fullTurn = {
      ...turn,
      callSid: this.callSid,
      order: this.nextOrder(),
      get version() {
        return turn.version;
      },

      get content() {
        return turn.content;
      },
      set content(content: string) {
        turn.content = content;
        emitUpdate();
      },
    };
    this.turnMap.set(fullTurn.id, fullTurn);
    return fullTurn;
  };

  /****************************************************
   Turn Setter Methods
  ****************************************************/

  setToolResult = (toolId: string, result: object) => {
    const toolTurn = [...this.turnMap.values()].find(
      (turn) =>
        turn.role === "bot" &&
        turn.type === "tool" &&
        (turn as BotToolTurn).tool_calls.some((tool) => tool.id === toolId)
    ) as BotToolTurn | undefined;

    if (!toolTurn) return;

    const tool = toolTurn.tool_calls.find((tool) => tool.id === toolId);
    if (!tool) return;

    tool.result = result;
    this.turnMap.set(toolTurn.id, toolTurn);
    return toolTurn;
  };
}

/****************************************************
 Turn Events
****************************************************/
interface TurnEvents {
  addedTurn: (turn: Turn) => void;
  updatedTurn: (id: string) => void;
}

/****************************************************
 Turn Creators
****************************************************/
export function makeBotDTMFTurn(
  params: BotDTMFTurnParams
): Omit<BotDTMFTurn, "order" | "callSid"> {
  return {
    ...params,
    createdAt: new Date().toISOString(),
    id: params.id ?? makeId("bot"),
    interrupted: params.interrupted ?? false,
    role: "bot",
    type: "dtmf",
    version: 0,
  };
}

export function makeBotTextTurn(
  params: BotTextTurnParams
): Omit<BotTextTurn, "order" | "callSid"> {
  return {
    ...params,
    createdAt: new Date().toISOString(),
    id: params.id ?? makeId("bot"),
    interrupted: params.interrupted ?? false,
    role: "bot",
    type: "text",
    version: 0,
  };
}

export function makeBotToolTurn(
  params: BotToolTurnParams
): Omit<BotToolTurn, "order" | "callSid"> {
  return {
    ...params,
    createdAt: new Date().toISOString(),
    id: params.id ?? makeId("bot"),
    role: "bot",
    type: "tool",
    version: 0,
  };
}

export function makeHumanDTMFTurn(
  params: HumanDTMFTurnParams
): Omit<HumanDTMFTurn, "order" | "callSid"> {
  return {
    ...params,
    createdAt: new Date().toISOString(),
    id: params.id ?? makeId("hum"),
    role: "human",
    type: "dtmf",
    version: 0,
  };
}

export function makeHumanTextTurn(
  params: HumanTextTurnParams
): Omit<HumanTextTurn, "order" | "callSid"> {
  return {
    ...params,
    createdAt: new Date().toISOString(),
    id: params.id ?? makeId("hum"),
    role: "human",
    type: "text",
    version: 0,
  };
}

export function makeSystemTurn(
  params: SystemTurnParams
): Omit<SystemTurn, "order" | "callSid"> {
  return {
    ...params,
    createdAt: new Date().toISOString(),
    id: params.id ?? makeId("sys"),
    role: "system",
    version: 0,
  };
}
