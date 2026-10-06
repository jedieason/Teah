// Only public runtime/model assets are fetched. Answers stay in this worker.
const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
export const MODEL = 'onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX';
export const REVISION = 'cdc8277b4682665e2f2e87cd83da7da07b153d75';
let instance;

async function load(progress) {
    instance ||= (async () => {
        const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import(RUNTIME);
        env.allowLocalModels = false;
        env.backends.onnx.wasm.numThreads = 1;
        const options = { revision: REVISION, progress_callback: progress };
        const tokenizer = await AutoTokenizer.from_pretrained(MODEL, options);
        // WASM works on browsers without WebGPU and without cross-origin isolation.
        const model = await AutoModelForSequenceClassification.from_pretrained(MODEL, { ...options, dtype: 'q8', device: 'wasm' });
        return { tokenizer, model };
    })().catch(error => { instance = null; throw error; });
    return instance;
}

export function nliScores(logits, labels) {
    const values = Array.from(logits), max = Math.max(...values);
    const exps = values.map(v => Math.exp(v - max)), sum = exps.reduce((a, b) => a + b, 0);
    const scores = {};
    exps.forEach((v, i) => { scores[String(labels[i]).toLowerCase()] = v / sum; });
    if (!Number.isFinite(scores.entailment) || !Number.isFinite(scores.contradiction)) throw new Error('Unknown NLI labels');
    return scores;
}

async function infer(pair, progress) {
    const { tokenizer, model } = await load(progress);
    const sentence = answer => `Question: ${pair.prompt}\nThe answer is ${answer}`;
    const a = sentence(pair.reference), b = sentence(pair.candidate);
    const direction = async (premise, hypothesis) => {
        const inputs = tokenizer(premise, { text_pair: hypothesis, truncation: false });
        // Never silently discard the end of a long answer or its negation.
        if (inputs.input_ids.dims.at(-1) > 512) return null;
        const output = await model(inputs);
        return nliScores(output.logits.data, model.config.id2label);
    };
    progress({ status: 'inference' });
    const forward = await direction(a, b), backward = await direction(b, a);
    return forward && backward ? { forward, backward } : { uncertainReason: 'too-long' };
}

// Serial inference avoids multiplying WASM memory use for queued answers.
let queue = Promise.resolve();
if (typeof self !== 'undefined') self.onmessage = ({ data: { id, pair } }) => {
    queue = queue.then(async () => {
        try {
            const result = await infer(pair, progress => self.postMessage({ id, progress }));
            self.postMessage({ id, result });
        } catch (error) { self.postMessage({ id, error: error.message || 'Local model unavailable' }); }
    });
};
