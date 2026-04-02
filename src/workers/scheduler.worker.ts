import { expose } from "comlink";
import { SchedulerEngine } from "@/lib/scheduler/engine";
import { optimizeSchedulerParameters, resolveSchedulerConfig, type RevlogOptimizationSample } from "@/lib/scheduler/params";
import type { Card } from "@/lib/types/card";
import type { ReviewRating, SchedulerConfig } from "@/lib/types/scheduler";

interface WorkerAnswerInput {
    readonly card: Card;
    readonly rating: ReviewRating;
    readonly config?: Partial<SchedulerConfig>;
    readonly now?: string | number | Date;
    readonly answerMillis?: number;
}

const engine = new SchedulerEngine();

const schedulerWorkerApi = {
    ping: () => "scheduler-worker-ready",
    previewCard: async (card: Card, config: Partial<SchedulerConfig> = {}, now?: string | number | Date) =>
        engine.previewCard(card, config, toDate(now)),
    answerCard: async (input: WorkerAnswerInput) => {
        const config = resolveSchedulerConfig(input.config);
        return engine.answerCard({
            card: input.card,
            rating: input.rating,
            config,
            now: toDate(input.now),
            answerMillis: input.answerMillis ?? 0,
        });
    },
    answerBatch: async (inputs: readonly WorkerAnswerInput[]) => {
        const results = [];
        for (const input of inputs) {
            const config = resolveSchedulerConfig(input.config);
            results.push(await engine.answerCard({
                card: input.card,
                rating: input.rating,
                config,
                now: toDate(input.now),
                answerMillis: input.answerMillis ?? 0,
            }));
        }
        return results;
    },
    optimizeParameters: (
        reviews: readonly RevlogOptimizationSample[],
        config: Partial<SchedulerConfig> = {},
    ) => optimizeSchedulerParameters(reviews, config),
};

export type SchedulerWorkerApi = typeof schedulerWorkerApi;

expose(schedulerWorkerApi);

function toDate(value: string | number | Date | undefined): Date {
    if (value instanceof Date) {
        return value;
    }

    if (typeof value === "number") {
        return new Date(value);
    }

    if (typeof value === "string") {
        return new Date(value);
    }

    return new Date();
}
