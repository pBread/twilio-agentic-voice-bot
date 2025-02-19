import { createEntityAdapter, createSlice } from "@reduxjs/toolkit";
import type { TurnRecord } from "@shared/session/turns";
import type { RootState } from "./store";

const SLICE_NAME = "turns";

const adapter = createEntityAdapter<TurnRecord>({
  sortComparer: (a, b) => b.order - a.order,
});

interface InitialState {
  loadingStates: Record<string, "loading" | "succeeded" | "failed">;
  loadingErrors: Record<string, string>;
}

export const turnsSlice = createSlice({
  name: SLICE_NAME,
  initialState: adapter.getInitialState({
    loadingStates: {},
    loadingErrors: {},
  } as InitialState),
  reducers: {
    addManyTurns: adapter.addMany,
    addOneTurn: adapter.addOne,
    removeAllTurns: adapter.removeAll,
    removeManyTurns: adapter.removeMany,
    removeOneTurn: adapter.removeOne,
    setAllTurns: adapter.setAll,
    setManyTurns: adapter.setMany,
    setOneTurn: adapter.setOne,
    updateManyTurns: adapter.updateMany,
    updateOneTurn: adapter.updateOne,
    upsertManyTurns: adapter.upsertMany,
    upsertOneTurn: adapter.upsertOne,
  },

  extraReducers: (builder) => {},
});

/****************************************************
 Selectors
****************************************************/
function getSlice(state: RootState) {
  return state[SLICE_NAME];
}

/****************************************************
 Actions
****************************************************/
export const {
  addManyTurns,
  addOneTurn,
  removeAllTurns,
  removeManyTurns,
  removeOneTurn,
  setAllTurns,
  setManyTurns,
  setOneTurn,
  updateManyTurns,
  updateOneTurn,
  upsertManyTurns,
  upsertOneTurn,
} = turnsSlice.actions;
