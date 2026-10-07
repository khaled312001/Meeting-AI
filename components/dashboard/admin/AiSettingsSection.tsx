"use client";

import * as React from "react";
import { CheckCircle2, Cpu, KeyRound, Loader2, Mic, Sparkles, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, ErrorBanner, Field, LoadingBlock, PageHeader, Pill, Select } from "../ui";
import { useToast } from "../toast";
import { useApi } from "@/lib/use-api";
import {
  adminApi,
  type KeySource,
  type ModelParams,
  type Provider,
  type TestResult,
  type ThinkingBudget,
} from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import { PROVIDER_LABEL } from "./AdminOverview";

const ANTHROPIC_MODELS = [
  { value: "claude-opus-5-5", label: "Opus 5.5 — most capable (recommended)" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5 — faster, lower cost" },
  { value: "claude-fable-5-1", label: "Fable 5.1" },
];
const CUSTOM = "__custom";

function sourceLabel(src: KeySource): string {
  return src === "dashboard" ? "Saved here" : src === "env" ? "From worker environment" : "Not set";
}

function TestResultLine({ result }: { result: TestResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <p className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-3 py-2 text-xs text-text-primary">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      <span>
        Connected{result.model ? ` to ${result.model}` : ""}. Reply: “{result.reply}”
      </span>
    </p>
  ) : (
    <p className="flex items-start gap-2 rounded-lg bg-destructive-muted px-3 py-2 text-xs text-text-primary">
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      <span>
        {result.status ? `HTTP ${result.status}: ` : ""}
        {result.error}
      </span>
    </p>
  );
}

/** Write-only secret input: shows where the current key comes from, never the key itself. */
function SecretField({
  id,
  label,
  configKey,
  source,
  masked,
  placeholder,
  onSaved,
}: {
  id: string;
  label: string;
  configKey: string;
  source: KeySource;
  masked?: string;
  placeholder: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await adminApi.updateConfig(configKey, value.trim());
      setValue("");
      toast.success(`${label} saved`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the key");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await adminApi.deleteConfig(configKey);
      toast.success(`${label} removed from the dashboard`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove the key");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Field
      label={label}
      htmlFor={id}
      hint={
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone={source === "none" ? "warning" : "success"}>{sourceLabel(source)}</Pill>
          {source === "dashboard" && masked && <code className="text-[11px] text-text-tertiary">{masked}</code>}
          {source === "dashboard" && (
            <button type="button" onClick={() => void remove()} className="text-[11px] text-text-tertiary underline hover:text-destructive">
              remove
            </button>
          )}
        </span>
      }
    >
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={source === "none" ? placeholder : "Enter a new key to replace it"}
        />
        <Button variant="secondary" onClick={() => void save()} disabled={saving || !value.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
    </Field>
  );
}

function ProviderOption({
  provider,
  active,
  ready,
  detail,
  icon: Icon,
  onSelect,
  busy,
}: {
  provider: Provider;
  active: boolean;
  ready: boolean;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-4 transition-colors",
        active ? "border-accent bg-accent-muted" : "border-border-subtle bg-surface-raised",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            active ? "bg-accent text-accent-foreground" : "bg-surface-overlay text-text-tertiary",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-text-primary">{PROVIDER_LABEL[provider]}</span>
        {active && (
          <Pill tone="success" dot>
            Active
          </Pill>
        )}
      </div>
      <p className="mt-2 min-h-[2.5em] truncate text-xs text-text-tertiary" title={detail}>
        {detail}
      </p>
      <div className="mt-3 flex items-center gap-2">
        {!ready && <Pill tone="warning">Needs setup</Pill>}
        {!active && (
          <Button size="sm" variant="outline" className="ml-auto" disabled={busy || !ready} onClick={onSelect}>
            Use this
          </Button>
        )}
      </div>
    </div>
  );
}

export function AiSettingsSection() {
  const toast = useToast();
  const overview = useApi((s) => adminApi.overview(s), []);
  const config = useApi((s) => adminApi.config(s), []);
  const openai = useApi((s) => adminApi.openaiConfig(s), []);
  const params = useApi((s) => adminApi.modelParams(s), []);
  const appConfig = useApi((s) => adminApi.appConfig(s), []);
  const [switching, setSwitching] = React.useState(false);

  const reloadAll = () => {
    void overview.reload();
    void config.reload();
    void openai.reload();
  };

  const rt = overview.data?.runtime;
  const cfg = config.data?.config ?? {};

  const switchProvider = async (p: Provider) => {
    setSwitching(true);
    try {
      const res = await adminApi.setProvider(p);
      if (!res.ok) throw new Error(res.error);
      toast.success(`${PROVIDER_LABEL[p]} now answers all requests`);
      reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't switch provider");
    } finally {
      setSwitching(false);
    }
  };

  const error = overview.error || config.error;

  return (
    <>
      <PageHeader
        title="AI & integrations"
        description="Choose which model answers questions, manage API keys and tune answer generation. Keys are stored on the server and never shown again after saving."
      />
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={reloadAll} />
        </div>
      )}

      {!rt ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <ProviderOption
              provider="anthropic"
              icon={Sparkles}
              active={rt.provider === "anthropic"}
              ready={rt.anthropicKeyConfigured}
              detail={rt.anthropicModel}
              busy={switching}
              onSelect={() => void switchProvider("anthropic")}
            />
            <ProviderOption
              provider="gemini"
              icon={Zap}
              active={rt.provider === "gemini"}
              ready={rt.geminiKeyConfigured}
              detail={rt.geminiModel}
              busy={switching}
              onSelect={() => void switchProvider("gemini")}
            />
            <ProviderOption
              provider="openai"
              icon={Cpu}
              active={rt.provider === "openai"}
              ready={Boolean(openai.data?.enabled)}
              detail={openai.data?.enabled ? `${openai.data.model} · ${openai.data.baseUrl}` : "Any OpenAI-compatible API"}
              busy={switching}
              onSelect={() => void switchProvider("openai")}
            />
          </div>

          <AnthropicCard
            source={rt.anthropicKeySource}
            masked={cfg.anthropic_key}
            savedModel={cfg.anthropic_model}
            effectiveModel={rt.anthropicModel}
            onSaved={reloadAll}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <GeminiCard
              source={rt.geminiKeySource}
              masked={cfg.gemini_key}
              model={rt.geminiModel}
              models={appConfig.data?.geminiModels ?? []}
              onSaved={reloadAll}
            />
            <Card title="Transcription (Deepgram)" description="Turns meeting audio into text in real time.">
              <div className="mb-4 flex items-center gap-2 text-xs text-text-secondary">
                <Mic className="h-3.5 w-3.5 text-text-tertiary" /> Required for live listening.
              </div>
              <SecretField
                id="dg-key"
                label="Deepgram API key"
                configKey="deepgram_key"
                source={rt.deepgramKeySource}
                masked={cfg.deepgram_key}
                placeholder="Paste your Deepgram key"
                onSaved={reloadAll}
              />
            </Card>
          </div>

          <OpenAiCard data={openai.data} onSaved={reloadAll} />

          <ModelParamsCard
            data={params.data?.defaults ?? null}
            baked={params.data?.bakedDefaults ?? null}
            onSaved={() => void params.reload()}
          />
        </div>
      )}
    </>
  );
}

function AnthropicCard({
  source,
  masked,
  savedModel,
  effectiveModel,
  onSaved,
}: {
  source: KeySource;
  masked?: string;
  savedModel?: string;
  effectiveModel: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const known = ANTHROPIC_MODELS.some((m) => m.value === effectiveModel);
  const [choice, setChoice] = React.useState(known ? effectiveModel : CUSTOM);
  const [custom, setCustom] = React.useState(known ? "" : effectiveModel);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<TestResult | null>(null);

  React.useEffect(() => {
    const k = ANTHROPIC_MODELS.some((m) => m.value === effectiveModel);
    setChoice(k ? effectiveModel : CUSTOM);
    setCustom(k ? "" : effectiveModel);
  }, [effectiveModel]);

  const model = choice === CUSTOM ? custom.trim() : choice;
  const changed = model && model !== effectiveModel;

  const saveModel = async () => {
    if (!model) return;
    setSaving(true);
    try {
      await adminApi.updateConfig("anthropic_model", model);
      toast.success("Anthropic model saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the model");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await adminApi.testAnthropic({ model: model || undefined }));
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="Anthropic"
      description="Grounded answers with citations from your users' knowledge files, prompt caching and automatic fallback."
      actions={
        <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing || source === "none"}>
          {testing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <KeyRound className="mr-1.5 h-3 w-3" />}
          Test connection
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <SecretField
          id="anthropic-key"
          label="Anthropic API key"
          configKey="anthropic_key"
          source={source}
          masked={masked}
          placeholder="sk-ant-…"
          onSaved={onSaved}
        />
        <Field
          label="Model"
          htmlFor="anthropic-model"
          hint={savedModel ? "Saved in the dashboard." : "Using the worker default (ANTHROPIC_MODEL)."}
        >
          <div className="flex gap-2">
            <Select
              id="anthropic-model"
              value={choice}
              onChange={setChoice}
              className="min-w-0 flex-1"
              options={[...ANTHROPIC_MODELS, { value: CUSTOM, label: "Custom model id…" }]}
            />
            <Button variant="secondary" onClick={() => void saveModel()} disabled={saving || !changed}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
          {choice === CUSTOM && (
            <Input
              className="mt-2"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. claude-opus-5-5"
              aria-label="Custom Anthropic model id"
            />
          )}
        </Field>
      </div>
      {result && (
        <div className="mt-4">
          <TestResultLine result={result} />
        </div>
      )}
    </Card>
  );
}

function GeminiCard({
  source,
  masked,
  model,
  models,
  onSaved,
}: {
  source: KeySource;
  masked?: string;
  model: string;
  models: Array<{ id: string; label: string }>;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [choice, setChoice] = React.useState(model);
  React.useEffect(() => setChoice(model), [model]);
  const options = models.some((m) => m.id === model) ? models : [{ id: model, label: model }, ...models];

  const save = async () => {
    try {
      await adminApi.updateConfig("gemini_model", choice);
      toast.success("Gemini model saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the model");
    }
  };

  return (
    <Card title="Google Gemini" description="Fast, low-cost alternative.">
      <div className="space-y-4">
        <SecretField
          id="gemini-key"
          label="Gemini API key"
          configKey="gemini_key"
          source={source}
          masked={masked}
          placeholder="AIza…"
          onSaved={onSaved}
        />
        <Field label="Model" htmlFor="gemini-model">
          <div className="flex gap-2">
            <Select
              id="gemini-model"
              value={choice}
              onChange={setChoice}
              className="min-w-0 flex-1"
              options={options.map((m) => ({ value: m.id, label: m.label }))}
            />
            <Button variant="secondary" onClick={() => void save()} disabled={choice === model}>
              Save
            </Button>
          </div>
        </Field>
      </div>
    </Card>
  );
}

function OpenAiCard({
  data,
  onSaved,
}: {
  data: { model: string; baseUrl: string; apiKey: string; hasApiKey: boolean; enabled: boolean; defaults: { baseUrl: string; model: string } } | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<TestResult | null>(null);

  React.useEffect(() => {
    if (!data) return;
    setBaseUrl(data.baseUrl || data.defaults.baseUrl);
    setModel(data.model || data.defaults.model);
  }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      await adminApi.saveOpenaiConfig({
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });
      setApiKey("");
      toast.success("OpenAI-compatible settings saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(
        await adminApi.testModel({
          baseUrl: baseUrl.trim() || undefined,
          modelName: model.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      );
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await adminApi.clearOpenaiConfig();
      toast.success("OpenAI-compatible settings cleared");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't clear");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="OpenAI-compatible endpoint"
      description="OpenAI, OpenRouter, Groq, a local server — anything that speaks /chat/completions."
      actions={
        data?.enabled ? (
          <Button variant="ghost" size="sm" onClick={() => void clear()} disabled={busy}>
            Clear
          </Button>
        ) : undefined
      }
    >
      {!data ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Base URL" htmlFor="oa-url">
              <Input id="oa-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={data.defaults.baseUrl} />
            </Field>
            <Field label="Model" htmlFor="oa-model">
              <Input id="oa-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={data.defaults.model} />
            </Field>
            <Field
              label="API key"
              htmlFor="oa-key"
              hint={data.hasApiKey ? <code className="text-[11px]">{data.apiKey}</code> : "Required on first save"}
            >
              <Input
                id="oa-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={data.hasApiKey ? "Keep current key" : "sk-…"}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => void test()} disabled={busy}>
              Test
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save
            </Button>
          </div>
          <TestResultLine result={result} />
        </div>
      )}
    </Card>
  );
}

const EFFORT_OPTIONS: ReadonlyArray<{ value: ThinkingBudget; label: string }> = [
  { value: "off", label: "Fastest — answers start immediately" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium — more careful answers" },
  { value: "high", label: "High — deepest reasoning, slower" },
];

function ModelParamsCard({
  data,
  baked,
  onSaved,
}: {
  data: ModelParams | null;
  baked: ModelParams | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = React.useState<{ maxOutputTokens: string; temperature: string; topP: string; thinkingBudget: ThinkingBudget } | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (data)
      setDraft({
        maxOutputTokens: String(data.maxOutputTokens),
        temperature: String(data.temperature),
        topP: String(data.topP),
        thinkingBudget: data.thinkingBudget,
      });
  }, [data]);

  const save = async () => {
    if (!draft) return;
    const maxOutputTokens = Math.round(Number(draft.maxOutputTokens));
    const temperature = Number(draft.temperature);
    const topP = Number(draft.topP);
    if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32768)
      return toast.error("Max answer length must be between 1 and 32,768 tokens");
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
      return toast.error("Temperature must be between 0 and 2");
    if (!Number.isFinite(topP) || topP < 0 || topP > 1) return toast.error("Top-p must be between 0 and 1");
    setSaving(true);
    try {
      await adminApi.saveModelParams({ maxOutputTokens, temperature, topP, thinkingBudget: draft.thinkingBudget });
      toast.success("Answer settings saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Answer generation defaults"
      description="Apply to every user unless overridden on their profile. Anthropic uses reasoning effort; temperature and top-p apply to Gemini and OpenAI-compatible models."
    >
      {!draft ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Max answer length (tokens)" htmlFor="mp-max" hint={baked ? `Default ${baked.maxOutputTokens}` : undefined}>
              <Input
                id="mp-max"
                inputMode="numeric"
                value={draft.maxOutputTokens}
                onChange={(e) => setDraft({ ...draft, maxOutputTokens: e.target.value })}
              />
            </Field>
            <Field label="Reasoning effort" htmlFor="mp-effort">
              <Select
                id="mp-effort"
                value={draft.thinkingBudget}
                onChange={(v) => setDraft({ ...draft, thinkingBudget: v as ThinkingBudget })}
                options={EFFORT_OPTIONS}
                className="w-full"
              />
            </Field>
            <Field label="Temperature" htmlFor="mp-temp" hint="0 – 2">
              <Input
                id="mp-temp"
                inputMode="decimal"
                value={draft.temperature}
                onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}
              />
            </Field>
            <Field label="Top-p" htmlFor="mp-topp" hint="0 – 1">
              <Input id="mp-topp" inputMode="decimal" value={draft.topP} onChange={(e) => setDraft({ ...draft, topP: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save defaults
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
