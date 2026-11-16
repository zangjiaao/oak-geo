"use client";
import { useEffect, useRef, useState } from "react";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
import { Link } from "@astryxdesign/core/Link";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/Stack";
import { FormDialog } from "./FormDialog";
import type { Collection, Seed } from "./SeedGenerationDialog";

type Point = {
  at: string;
  period_label?: string;
  value: number | null;
  display: string;
  censored: boolean;
  partial: boolean | null;
};
type Summary = {
  latest: number | null;
  min: number | null;
  max: number | null;
  point_count: number;
  missing_points: number;
};
type Series = Record<string, unknown> & {
  id: string;
  keyword: string;
  provider: string;
  geo: string;
  metric: string;
  collected_at: string;
  summary: Summary;
  source_url?: string;
  seed_context?: { seeds: { word: string; seed_version: number }[] };
};
const sourceName = (p: string) =>
  p === "google_trends" ? "Google Trends" : "百度指数";
const metricName = (m: string) =>
  ({ interest: "相对热度", all: "整体", pc: "PC", mobile: "移动" })[m] ?? m;
const valueText = (n: number | null | undefined) =>
  n == null ? "—" : String(n);
const regions = [
  { value: "CN", label: "中国" },
  { value: "WORLD", label: "全球" },
  { value: "US", label: "美国" },
  { value: "GB", label: "英国" },
  { value: "JP", label: "日本" },
];
async function dataOf(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data;
}
const endpoint = (tid: string) =>
  `/api/tenants/${encodeURIComponent(tid)}/keyword-imports`;

// A native SVG data plot, not a decorative icon. Its size/color use design tokens.
function TrendLine({ points }: { points: Point[] }) {
  const valid = points.filter((p) => p.value != null && p.partial !== true),
    min = Math.min(...valid.map((p) => p.value!)),
    max = Math.max(...valid.map((p) => p.value!));
  const first = Date.parse(points[0]?.at),
    last = Date.parse(points.at(-1)?.at ?? "");
  const segments: string[][] = [[]];
  points.forEach((p) => {
    if (p.value == null || p.partial === true) {
      if (segments.at(-1)!.length) segments.push([]);
      return;
    }
    segments
      .at(-1)!
      .push(
        `${first === last ? 80 : 4 + ((Date.parse(p.at) - first) * 152) / (last - first)},${max === min ? 20 : 36 - ((p.value - min) * 32) / (max - min)}`,
      );
  });
  if (!valid.length) return <Text type="supporting">没有可绘制的有效指数</Text>;
  return (
    <svg
      role="img"
      aria-label="当前序列走势，独立刻度，缺失点留空"
      viewBox="0 0 160 40"
      style={{
        width: "100%",
        height: "calc(var(--spacing-10) * 3)",
        color: "var(--color-accent)",
      }}
    >
      {segments
        .filter((s) => s.length)
        .map((s, i) =>
          s.length === 1 ? (
            <circle
              key={i}
              cx={s[0].split(",")[0]}
              cy={s[0].split(",")[1]}
              r="1"
              fill="currentColor"
            />
          ) : (
            <polyline
              key={i}
              points={s.join(" ")}
              stroke="currentColor"
              fill="none"
              strokeWidth="1"
            />
          ),
        )}
    </svg>
  );
}

export function SeedCollectionDialog({
  collection,
  tenantId,
  industry,
  market,
  onClose,
  onSaved,
}: {
  collection: Collection;
  tenantId: string;
  industry: string;
  market: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState("api"),
    [geo, setGeo] = useState(market === "CN" ? "CN" : "WORLD");
  const [start, setStart] = useState(() =>
      new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10),
    ),
    [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [format, setFormat] = useState("google_trends_csv"),
    [metric, setMetric] = useState("all"),
    [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [collectedAt] = useState(() => new Date().toISOString());
  const pending = useRef<{ signature: string; key: string } | null>(null);
  async function collect() {
    setBusy(true);
    setError("");
    try {
      let input: Record<string, unknown>;
      if (mode === "api")
        input = {
          source_query: {
            provider: "google_trends_serpapi",
            geo,
            start,
            end,
            seed_context: collection.seed_context,
          },
        };
      else {
        if (!file) throw new Error("请选择CSV文件");
        if (file.size > 1048576) throw new Error("CSV需小于1MiB");
        const bytes = await file.arrayBuffer(),
          head = new Uint8Array(bytes);
        const encoding =
          head[0] === 255 && head[1] === 254
            ? "utf-16le"
            : head[0] === 254 && head[1] === 255
              ? "utf-16be"
              : "utf-8";
        const csv = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        input = {
          trend_import: {
            format,
            csv,
            geo,
            metric,
            keyword:
              collection.keywords.length === 1
                ? collection.keywords[0]
                : undefined,
            collected_at: collectedAt,
            seed_context: collection.seed_context,
          },
        };
      }
      const body = JSON.stringify({ industry, channel: "A", ...input });
      if (pending.current?.signature !== body)
        pending.current = { signature: body, key: crypto.randomUUID() };
      const data = await dataOf(
        await fetch(endpoint(tenantId), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": pending.current.key,
          },
          body,
        }),
      );
      if (data.rejected)
        throw new Error(`有 ${data.rejected} 个检索词未保存，请核对数据`);
      pending.current = null;
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "采集失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      isOpen
      title="采集检索词"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={collect}
      submitLabel={mode === "api" ? "开始采集" : "补录并保存"}
      disabled={mode === "csv" && !file}
    >
      <Text>
        {industry} · {collection.keywords.join("、")}
      </Text>
      <Selector
        label="采集方式"
        value={mode}
        onChange={setMode}
        options={[
          { value: "api", label: "Google Trends" },
          { value: "csv", label: "CSV 补录" },
        ]}
      />
      <Selector label="地域" value={geo} onChange={setGeo} options={regions} />
      {mode === "api" ? (
        <>
          <TextInput
            label="开始日期"
            value={start}
            onChange={setStart}
            placeholder="YYYY-MM-DD"
          />
          <TextInput
            label="结束日期"
            value={end}
            onChange={setEnd}
            placeholder="YYYY-MM-DD"
          />
          <Text type="supporting">
            本次查询 {collection.keywords.length}{" "}
            个词，将调用1次数据接口并可能计费；失败可切换CSV补录。
          </Text>
        </>
      ) : (
        <>
          <Selector
            label="文件来源"
            value={format}
            onChange={setFormat}
            options={[
              { value: "google_trends_csv", label: "Google Trends CSV" },
              { value: "baidu_index_csv", label: "百度指数 CSV" },
            ]}
          />
          {format === "baidu_index_csv" && (
            <Selector
              label="指数口径"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "all", label: "整体" },
                { value: "pc", label: "PC" },
                { value: "mobile", label: "移动" },
              ]}
            />
          )}
          <FileInput
            label="CSV文件"
            value={file}
            onChange={(v) => setFile(Array.isArray(v) ? v[0] : v)}
            accept=".csv,text/csv"
            maxSize={1048576}
          />
          <Text type="supporting">
            文件需包含本次所选检索词，原始表头无需重排。
          </Text>
        </>
      )}
    </FormDialog>
  );
}

export function SeedTrendHistoryDialog({
  tenantId,
  industry,
  seed,
  onClose,
}: {
  tenantId: string;
  industry: string;
  seed?: Seed;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Series[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    series: Series;
    points: Point[];
    cursor: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = endpoint(tenantId);
  const params = new URLSearchParams({
    view: "trends",
    industry,
    limit: "20",
    ...(seed ? { seed_logical_id: seed.logical_id } : {}),
  });
  const listUrl = base + "?" + params;
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    fetch(listUrl, { signal: controller.signal })
      .then(dataOf)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data.items);
          setCursor(data.next_cursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [listUrl]);
  async function load(next?: Series) {
    setBusy(true);
    setError("");
    try {
      if (next || detail) {
        const series = next ?? detail!.series;
        const q = new URLSearchParams({
          view: "trend_points",
          id: series.id,
          limit: "100",
          ...(!next && detail?.cursor ? { cursor: detail.cursor } : {}),
        });
        const data = await dataOf(await fetch(base + "?" + q));
        setDetail({
          series: { ...series, ...data.series },
          points: next ? data.items : [...detail!.points, ...data.items],
          cursor: data.next_cursor,
        });
      } else {
        const data = await dataOf(
          await fetch(
            listUrl + "&" + new URLSearchParams({ cursor: cursor ?? "" }),
          ),
        );
        setRows((old) => [...old, ...data.items]);
        setCursor(data.next_cursor);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog
      isOpen
      title={
        detail
          ? detail.series.keyword
          : seed
            ? "采集记录 · " + seed.word
            : "行业采集记录"
      }
      onClose={onClose}
      busy={busy}
      error={error}
    >
      {detail ? (
        <>
          <HStack gap={3} hAlign="between">
            <Text>
              {sourceName(detail.series.provider)} · {detail.series.geo} ·{" "}
              {metricName(detail.series.metric)}
            </Text>
            <Button
              label="返回记录"
              isDisabled={busy}
              onClick={() => {
                setDetail(null);
                setError("");
              }}
            />
          </HStack>
          {detail.series.seed_context && (
            <Text type="supporting">
              来源种子：
              {detail.series.seed_context.seeds
                .map((s) => `${s.word} v${s.seed_version}`)
                .join("、")}
            </Text>
          )}
          <Text type="supporting">
            期内最低 {valueText(detail.series.summary.min)}，最高{" "}
            {valueText(detail.series.summary.max)}；缺失{" "}
            {detail.series.summary.missing_points} 点。走势使用单序列独立刻度。
          </Text>
          <TrendLine points={detail.points} />
          <Text type="supporting">
            已显示 {detail.points.length}/{detail.series.summary.point_count}{" "}
            个时间点
          </Text>
          <Table
            data={detail.points}
            idKey="at"
            columns={[
              {
                key: "at",
                header: "周期",
                renderCell: (p) => (
                  <Text>{p.period_label || p.at.slice(0, 10)}</Text>
                ),
              },
              { key: "display", header: "来源指数" },
              {
                key: "partial",
                header: "说明",
                renderCell: (p) => (
                  <Text>
                    {p.partial
                      ? "部分周期"
                      : p.censored
                        ? "低于1"
                        : p.value == null
                          ? "缺数据"
                          : "—"}
                  </Text>
                ),
              },
            ]}
          />
          {detail.cursor && (
            <Button
              label="加载更多时间点"
              isDisabled={busy}
              onClick={() => load()}
            />
          )}
          {detail.series.source_url && (
            <Link href={detail.series.source_url} target="_blank">
              来源页面
            </Link>
          )}
        </>
      ) : rows.length ? (
        <>
          <Table
            data={rows}
            idKey="id"
            columns={[
              { key: "keyword", header: "检索词" },
              {
                key: "provider",
                header: "来源",
                renderCell: (r) => (
                  <Text>
                    {sourceName(r.provider)} · {r.geo} · {metricName(r.metric)}
                  </Text>
                ),
              },
              {
                key: "summary",
                header: "最新可用指数",
                renderCell: (r) => <Text>{valueText(r.summary.latest)}</Text>,
              },
              {
                key: "collected_at",
                header: "采集时间",
                renderCell: (r) => (
                  <Text>
                    {r.collected_at.slice(0, 19).replace("T", " ")} UTC
                  </Text>
                ),
              },
              {
                key: "id",
                header: "操作",
                renderCell: (r) => (
                  <Button
                    label="查看证据"
                    onClick={() => load(r)}
                    isDisabled={busy}
                  />
                ),
              },
            ]}
          />
          {cursor && (
            <Button
              label="加载更多记录"
              onClick={() => load()}
              isDisabled={busy}
            />
          )}
        </>
      ) : (
        <EmptyState title={busy ? "正在读取采集记录" : "尚无采集记录"} />
      )}
    </FormDialog>
  );
}
