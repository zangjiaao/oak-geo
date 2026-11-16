"use client";
import { useEffect, useRef, useState } from "react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Link } from "@astryxdesign/core/Link";
import { FormDialog } from "./FormDialog";
import { ListToolbar, ListFooter } from "./ListPage";
import { listWindow } from "@/lib/list-view.mjs";
import { parseTrendExport, summarizeTrend } from "@/lib/trend-source.mjs";

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
  available_points: number;
  missing_points: number;
  partial_points: number;
  statistics_window: { start: string; end: string };
};
interface Series extends Record<string, unknown> {
  id: string;
  keyword: string;
  provider: string;
  geo: string;
  metric: string;
  acquisition: string;
  summary: Summary;
  collected_at: string;
  points?: Point[];
  source_url?: string;
}
type Session = { tenant_id: string; can_write: boolean; role: string } | null;
const sourceName = (value: string) =>
  value === "google_trends" ? "Google Trends" : "百度指数";
const metricName = (value: string) =>
  ({ interest: "相对热度", all: "整体", pc: "PC", mobile: "移动" })[value] ??
  value;
const valueText = (value: number | null | undefined) =>
  value == null ? "—" : String(value);
const regions = [
  { value: "CN", label: "中国" },
  { value: "WORLD", label: "全球" },
  { value: "US", label: "美国" },
  { value: "GB", label: "英国" },
  { value: "JP", label: "日本" },
];

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

export function TrendSourcePanel({
  session,
  industryContext = "",
}: {
  session: Session;
  industryContext?: string;
}) {
  const [rows, setRows] = useState<Series[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [preview, setPreview] = useState<{
      rows: Series[];
      input: Record<string, unknown>;
    } | null>(null);
  const [dialog, setDialog] = useState<"file" | "live" | null>(null),
    [file, setFile] = useState<File | null>(null),
    [format, setFormat] = useState("google_trends_csv"),
    [metric, setMetric] = useState("all"),
    [geo, setGeo] = useState("CN"),
    [keyword, setKeyword] = useState("");
  const [industry, setIndustry] = useState(industryContext),
    [start, setStart] = useState(() =>
      new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10),
    ),
    [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState(""),
    [provider, setProvider] = useState("all"),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [detail, setDetail] = useState<{
    series: Series;
    points: Point[];
    cursor: string | null;
  } | null>(null);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const base = session
    ? `/api/tenants/${encodeURIComponent(session.tenant_id)}/keyword-imports`
    : "";
  const canRead = Boolean(
    session && ["strategist", "factcheck", "cs"].includes(session.role),
  );
  async function responseData(response: Response) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
    return body.data;
  }
  async function history(next: string | null = null) {
    if (!canRead) return;
    const params = new URLSearchParams({
      view: "trends",
      limit: "100",
      ...(industry ? { industry } : {}),
      ...(next ? { cursor: next } : {}),
    });
    const data = await responseData(await fetch(base + "?" + params));
    setRows((old) => (next ? [...old, ...data.items] : data.items));
    setCursor(data.next_cursor);
  }
  useEffect(() => {
    let current = true;
    if (!canRead) {
      setRows([]);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      view: "trends",
      limit: "100",
      ...(industry ? { industry } : {}),
    });
    fetch(base + "?" + params, { signal: controller.signal })
      .then(responseData)
      .then((data) => {
        if (current) {
          setRows(data.items);
          setCursor(data.next_cursor);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [base, canRead, industry]);
  const combined = [...(preview?.rows ?? []), ...rows];
  const view = listWindow(combined, {
    query,
    fields: ["keyword", "geo"],
    page,
    matches: (r: Series) => provider === "all" || r.provider === provider,
  });
  function open(kind: "file" | "live") {
    setError("");
    setDialog(kind);
  }
  async function analyzeFile() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const bytes = await file.arrayBuffer();
      const view = new Uint8Array(bytes);
      const encoding =
        view[0] === 255 && view[1] === 254
          ? "utf-16le"
          : view[0] === 254 && view[1] === 255
            ? "utf-16be"
            : "utf-8";
      const csv = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      const input = {
        format,
        csv,
        keyword,
        geo,
        metric,
        collected_at: new Date().toISOString(),
      };
      const dataset = parseTrendExport(csv, input);
      setPreview({
        input,
        rows: dataset.series.map(
          (s: { keyword: string; points: Point[] }, i: number) => ({
            id: "preview-" + i,
            keyword: s.keyword,
            provider: dataset.provider,
            geo: dataset.geo,
            metric: dataset.metric,
            acquisition: "preview",
            collected_at: dataset.collected_at,
            points: s.points,
            summary: summarizeTrend(s),
            source_url: dataset.source_url,
          }),
        ),
      });
      setPage(1);
      setDialog(null);
      setMessage("已解析，确认后可保存到词库");
    } catch (e) {
      setError(e instanceof Error ? e.message : "文件解析失败");
    } finally {
      setBusy(false);
    }
  }
  async function write(body: Record<string, unknown>) {
    if (!session?.can_write || !industry.trim()) return;
    setBusy(true);
    setError("");
    try {
      const input = { industry: industry.trim(), channel: "A", ...body },
        signature = JSON.stringify(input);
      if (pending.current?.signature !== signature)
        pending.current = { signature, key: crypto.randomUUID() };
      const data = await responseData(
        await fetch(base, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": pending.current.key,
          },
          body: signature,
        }),
      );
      pending.current = null;
      setMessage(
        `新增 ${data.added}，重复 ${data.duplicate}，拒绝 ${data.rejected}`,
      );
      setDialog(null);
      setPreview(null);
      await history();
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "获取或保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function show(row: Series) {
    setError("");
    if (row.points) {
      setDetail({ series: row, points: row.points, cursor: null });
      return;
    }
    setBusy(true);
    try {
      const data = await responseData(
        await fetch(
          base +
            "?" +
            new URLSearchParams({
              view: "trend_points",
              id: row.id,
              limit: "100",
            }),
        ),
      );
      setDetail({
        series: { ...row, ...data.series },
        points: data.items,
        cursor: data.next_cursor,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  async function morePoints() {
    if (!detail?.cursor) return;
    setBusy(true);
    try {
      const data = await responseData(
        await fetch(
          base +
            "?" +
            new URLSearchParams({
              view: "trend_points",
              id: detail.series.id,
              limit: "100",
              cursor: detail.cursor,
            }),
        ),
      );
      setDetail({
        ...detail,
        points: [...detail.points, ...data.items],
        cursor: data.next_cursor,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ListToolbar>
        <HStack gap={3} wrap="wrap">
          <TextInput
            label="搜索已加载序列"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
          <Selector
            label="来源"
            value={provider}
            options={[
              { value: "all", label: "全部来源" },
              { value: "google_trends", label: "Google Trends" },
              { value: "baidu_index", label: "百度指数" },
            ]}
            onChange={(v) => {
              setProvider(v);
              setPage(1);
            }}
          />
        </HStack>
        <HStack gap={3} wrap="wrap">
          <Button
            label="分析导出文件"
            onClick={() => open("file")}
            isDisabled={busy}
          />
          <Button
            label="获取 Google Trends"
            onClick={() => open("live")}
            isDisabled={!session?.can_write || busy}
          />
          {preview && (
            <Button
              label="保存预览到词库"
              variant="primary"
              onClick={() => write({ trend_import: preview.input })}
              isDisabled={!session?.can_write || !industry || busy}
            />
          )}
        </HStack>
      </ListToolbar>
      {message && <Text role="status">{message}</Text>}
      {error && !dialog && <Text role="alert">{error}</Text>}
      {combined.length ? (
        <>
          <Table
            data={view.items}
            idKey="id"
            columns={[
              { key: "keyword", header: "关键词" },
              {
                key: "provider",
                header: "来源",
                renderCell: (r) => <Text>{sourceName(r.provider)}</Text>,
              },
              { key: "geo", header: "地域" },
              {
                key: "metric",
                header: "口径",
                renderCell: (r) => <Text>{metricName(r.metric)}</Text>,
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
                key: "acquisition",
                header: "状态",
                renderCell: (r) => (
                  <Text>
                    {r.acquisition === "preview"
                      ? "待保存"
                      : r.acquisition === "api"
                        ? "API获取"
                        : "文件导入"}
                  </Text>
                ),
              },
              {
                key: "id",
                header: "操作",
                renderCell: (r) => (
                  <Button
                    label="看走势"
                    onClick={() => show(r)}
                    isDisabled={busy}
                  />
                ),
              },
            ]}
          />
          <ListFooter page={view.page} total={view.total} onChange={setPage} />
          {cursor && (
            <Button
              label="加载更多历史序列"
              onClick={() => history(cursor).catch((e) => setError(e.message))}
              isDisabled={busy}
            />
          )}
        </>
      ) : (
        <EmptyState title="导入指数文件，或获取 Google Trends" />
      )}
      <FormDialog
        isOpen={dialog !== null}
        title={dialog === "file" ? "分析导出文件" : "获取 Google Trends"}
        onClose={() => setDialog(null)}
        onSubmit={
          dialog === "file"
            ? analyzeFile
            : () =>
                write({
                  source_query: {
                    provider: "google_trends_serpapi",
                    keywords: keyword
                      .split(/[\n,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    geo,
                    start,
                    end,
                  },
                })
        }
        submitLabel={dialog === "file" ? "分析" : "获取并保存"}
        busy={busy}
        error={error}
        disabled={
          dialog === "file" ? !file : !industry.trim() || !keyword.trim()
        }
      >
        {dialog === "file" ? (
          <>
            <Selector
              label="文件来源"
              value={format}
              options={[
                { value: "google_trends_csv", label: "Google Trends CSV" },
                { value: "baidu_index_csv", label: "百度指数 CSV" },
              ]}
              onChange={setFormat}
            />
            <FileInput
              label="CSV文件"
              value={file}
              onChange={(v) => setFile(Array.isArray(v) ? v[0] : v)}
              accept=".csv,text/csv"
              maxSize={1048576}
            />
            {format === "baidu_index_csv" && (
              <>
                <Selector
                  label="指数口径"
                  value={metric}
                  options={[
                    { value: "all", label: "整体" },
                    { value: "pc", label: "PC" },
                    { value: "mobile", label: "移动" },
                  ]}
                  onChange={setMetric}
                />
                <TextInput
                  label="关键词（文件没有关键词列时填写）"
                  value={keyword}
                  onChange={setKeyword}
                />
              </>
            )}
          </>
        ) : (
          <>
            <TextArea
              label="关键词（最多5个，一行一个）"
              value={keyword}
              onChange={setKeyword}
            />
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
            <TextInput label="行业" value={industry} onChange={setIndustry} />
            <Text type="supporting">
              使用服务端 SerpAPI 账号获取；指数为相对热度。
            </Text>
          </>
        )}
        <Selector
          label="地域"
          value={geo}
          options={regions}
          onChange={setGeo}
        />
        {dialog === "file" && session?.can_write && !industry && (
          <TextInput
            label="保存到行业"
            value={industry}
            onChange={setIndustry}
          />
        )}
      </FormDialog>
      <FormDialog
        isOpen={detail !== null}
        title={detail?.series.keyword ?? "走势"}
        onClose={() => setDetail(null)}
        busy={busy}
        error={error}
      >
        {detail && (
          <>
            <Text>
              {sourceName(detail.series.provider)} · {detail.series.geo} ·{" "}
              {metricName(detail.series.metric)}
            </Text>
            <Text type="supporting">
              期内最低 {valueText(detail.series.summary.min)}，最高{" "}
              {valueText(detail.series.summary.max)}；缺失{" "}
              {detail.series.summary.missing_points}{" "}
              点。走势使用单序列独立刻度。
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
                  header: "日期",
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
                onClick={morePoints}
                isDisabled={busy}
              />
            )}
            {detail.series.source_url && (
              <Link href={detail.series.source_url} target="_blank">
                来源页面
              </Link>
            )}
          </>
        )}
      </FormDialog>
    </>
  );
}
