import { expose } from "comlink";

const schedulerWorkerApi = {
  ping: () => "scheduler-worker-ready",
};

export type SchedulerWorkerApi = typeof schedulerWorkerApi;

expose(schedulerWorkerApi);
