import { expose } from "comlink";

const importWorkerApi = {
    ping: () => "import-worker-ready",
};

export type ImportWorkerApi = typeof importWorkerApi;

expose(importWorkerApi);
