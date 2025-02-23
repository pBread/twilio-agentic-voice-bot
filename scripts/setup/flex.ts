import Twilio from "twilio";
import { fileURLToPath } from "url";
import { closeRL, EnvManager, selectOption, sLog } from "./helpers.js";

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

(async () => {
  if (!isMainModule) return;
  const env = new EnvManager(".env");
  env.assertAccountSid();
  env.assertApiKeys();
  await checkGetTaskrouterSids(env);
  await setupFlexWorker(env);

  closeRL();
})();

export async function checkGetTaskrouterSids(env: EnvManager) {
  const allDefined =
    env.vars.FLEX_WORKFLOW_SID &&
    env.vars.FLEX_WORKSPACE_SID &&
    env.vars.FLEX_QUEUE_SID;

  if (allDefined) return sLog.info("flex env vars are defined");

  const someDefined =
    env.vars.FLEX_WORKFLOW_SID ||
    env.vars.FLEX_WORKSPACE_SID ||
    env.vars.FLEX_QUEUE_SID;

  if (someDefined)
    return sLog.warn(
      "some flex env vars are defined, others are not. cannot setup flex automatically",
    );

  try {
    sLog.info("checking taskrouter environment");
    const twlo = Twilio(env.vars.TWILIO_API_KEY, env.vars.TWILIO_API_SECRET, {
      accountSid: env.vars.TWILIO_ACCOUNT_SID,
    });

    const workspaces = await twlo.taskrouter.v1.workspaces.list();
    if (!workspaces.length) {
      sLog.warn(
        `no taskrouter workspaces found. env variables must be manually added`,
      );
      return false;
    }
    if (workspaces.length > 1) {
      sLog.warn(
        `unable to configure flex. env variables must be manually added`,
      );
      return false;
    }

    const [ws] = workspaces;

    const workflows = await twlo.taskrouter.v1
      .workspaces(ws.sid)
      .workflows.list();

    if (!workflows.length) {
      sLog.warn(
        `no taskrouter workflows found. env variables must be manually added`,
      );
      return false;
    }
    if (workflows.length > 1) {
      sLog.warn(
        `unable to configure flex. env variables must be manually added`,
      );
      return false;
    }

    const [wf] = workflows;

    const queues = await twlo.taskrouter.v1
      .workspaces(ws.sid)
      .taskQueues.list();

    if (!queues.length) {
      sLog.warn(
        `no taskrouter queues found. env variables must be manually added`,
      );
      return false;
    }
    if (queues.length > 1) {
      sLog.warn(
        `unable to configure flex. env variables must be manually added`,
      );
      return false;
    }

    const [queue] = queues;

    env.vars.FLEX_WORKFLOW_SID = wf.sid;
    env.vars.FLEX_WORKSPACE_SID = ws.sid;
    env.vars.FLEX_QUEUE_SID = queue.sid;

    await env.save();
  } catch (error) {
    sLog.error("error trying to fetch taskrouter sids. error: ", error);
    return false;
  }
}

export async function setupFlexWorker(env: EnvManager) {
  const allDefined =
    env.vars.FLEX_WORKFLOW_SID &&
    env.vars.FLEX_WORKSPACE_SID &&
    env.vars.FLEX_QUEUE_SID;

  if (!allDefined) return;

  if (!env.vars.FLEX_WORKSPACE_SID)
    return sLog.info(
      "unable to select flex worker because FLEX_WORKSPACE_SID is undefined",
    );

  try {
    sLog.info("checking flex workers environment");
    const twlo = Twilio(env.vars.TWILIO_API_KEY, env.vars.TWILIO_API_SECRET, {
      accountSid: env.vars.TWILIO_ACCOUNT_SID,
    });

    const workers = await twlo.taskrouter.v1
      .workspaces(env.vars.FLEX_WORKSPACE_SID)
      .workers.list();

    if (!workers.length)
      return sLog.warn(
        "unable to setup flex worker because there are no workers. log into your flex console from the twilio console and a worker will be created automatically",
      );

    const result = await selectOption(
      "Are any of these workers you?",
      workers
        .map((worker) => ({
          label: worker.friendlyName,
          value: worker.sid,
        }))
        .concat({ label: "none of these are me", value: "" }),
    );

    if (result?.length) {
      env.vars.FLEX_WORKER_SID = result;
      await env.save();
    }
  } catch (error) {
    sLog.error("error selecting worker. error: ", error);
    throw error;
  }
}
