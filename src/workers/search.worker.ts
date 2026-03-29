import { expose } from "comlink";

const searchWorkerApi = {
    ping: () => "search-worker-ready",
};

export type SearchWorkerApi = typeof searchWorkerApi;

expose(searchWorkerApi);
