import {createQuestionTransport} from '@/server/api/question-http.mjs';
import {createWorkerRuntime} from '@/server/api/worker-runtime.mjs';
export const dynamic='force-dynamic';
export const GET=createQuestionTransport(createWorkerRuntime);
export const POST=GET;
