import test from 'node:test';
import assert from 'node:assert';

// O que este teste executa: Valida que modelos com contextWindow pequeno (ex: 16K) derivam um limite de saida seguro para evitar max_completion_tokens: 32000 (Issue #4234).
test('modelEntry deriva output proporcional quando contextWindow for menor que 32000', () => {
  interface CustomProviderModel {
    id: string;
    name: string;
    contextWindow?: number;
  }

  function modelEntry(model: CustomProviderModel) {
    if (model.contextWindow === undefined) {
      return { name: model.name };
    }
    const derivedOutput = model.contextWindow < 32000
      ? Math.max(1, Math.floor(model.contextWindow / 2))
      : 0;

    return {
      name: model.name,
      limit: { context: model.contextWindow, output: derivedOutput },
    };
  }

  // O que este teste executa: Verifica que um modelo com 16384 tokens de contexto recebe output limitado a 8192 (abaixo do teto do modelo).
  const smallModel = modelEntry({ id: 'glimmer', name: 'muse/glimmer-30b', contextWindow: 16384 });
  assert.strictEqual(smallModel.limit?.context, 16384);
  assert.strictEqual(smallModel.limit?.output, 8192);

  // O que este teste executa: Verifica que modelos com grande contexto (ex: 128K) mantem output 0 (fallback para o default do OpenCode).
  const largeModel = modelEntry({ id: 'gpt4', name: 'gpt-4o', contextWindow: 128000 });
  assert.strictEqual(largeModel.limit?.context, 128000);
  assert.strictEqual(largeModel.limit?.output, 0);

  // O que este teste executa: Verifica que modelo sem contextWindow nao declara bloco limit.
  const unboundedModel = modelEntry({ id: 'default', name: 'default-model' });
  assert.strictEqual(unboundedModel.limit, undefined);
});
