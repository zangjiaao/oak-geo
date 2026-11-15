"use client";
import { useRef, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormDialog } from "./FormDialog";
import { ListToolbar, ListFooter } from "./ListPage";
import { listWindow } from "@/lib/list-view.mjs";
import {
  keywordImportFields,
  keywordImportTemplate,
} from "@/lib/keyword-import-template.mjs";
type Session = { tenant_id: string; can_write: boolean } | null;
interface ResultRow extends Record<string, unknown> {
  record_number: number;
  outcome: string;
  code?: string;
}
type Report = {
  added: number;
  duplicate: number;
  rejected: number;
  record_results: ResultRow[];
  truncated: boolean;
};
export function CsvImportPanel({
  session,
  industryContext = "",
}: {
  session: Session;
  industryContext?: string;
}) {
  const [file, setFile] = useState<File | null>(null),
    [channel, setChannel] = useState("B"),
    [industry, setIndustry] = useState(industryContext || "B2B"),
    [sourceId, setSourceId] = useState(""),
    [authorization, setAuthorization] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [reportContext, setReportContext] = useState<{
    channel: string;
    industry: string;
  } | null>(null);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"import" | "fields" | null>(null);
  const [query, setQuery] = useState(""),
    [outcome, setOutcome] = useState("all"),
    [page, setPage] = useState(1);
  const pending = useRef<{
    signature: string;
    key: string;
    body: string;
  } | null>(null);
  const rows = (report?.record_results ?? []).map((row) => ({
    ...row,
    display_reason:
      row.code === "observation_conflict"
        ? "同一时点的数据或出处冲突"
        : row.code
          ? "字段无效，请检查时间和指数等输入"
          : "—",
    display_outcome:
      row.outcome === "added"
        ? "新增"
        : row.outcome === "duplicate"
          ? "重复"
          : "拒绝",
  }));
  const view = listWindow(rows, {
    query,
    fields: ["record_number", "display_reason"],
    page,
    pageSize: 10,
    matches: (row) => outcome === "all" || row.outcome === outcome,
  });
  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([keywordImportTemplate(channel)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `keyword-import-${channel}.csv`;
    link.hidden = true;
    document.body.append(link);
    try {
      link.click();
      setMessage("模板已下载");
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  async function submit() {
    if (!file || !session) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        industry,
        channel,
        csv: await file.text(),
        ...(channel !== "C" && sourceId.trim()
          ? { source_id: sourceId.trim() }
          : {}),
        ...(channel === "C" ? { authorization_ref: authorization } : {}),
      };
      const signature = JSON.stringify(body);
      if (pending.current?.signature !== signature)
        pending.current = {
          signature,
          key: crypto.randomUUID(),
          body: signature,
        };
      const response = await fetch(
          `/api/tenants/${encodeURIComponent(session.tenant_id)}/keyword-imports`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": pending.current.key,
            },
            body: pending.current.body,
          },
        ),
        data = await response.json();
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "当前账号无导入权限，或文件/书面授权无效"
            : (data.error?.message ?? "导入失败"),
        );
      setReport(data.data);
      setReportContext({ channel, industry });
      pending.current = null;
      setFile(null);
      setDialog(null);
      setQuery("");
      setOutcome("all");
      setPage(1);
      setMessage("导入处理完成");
    } catch (error) {
      setError(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }
  const channels = [
    { value: "A", label: "A · 检索类" },
    { value: "B", label: "B · 平台内" },
    { value: "C", label: "C · 自有一手" },
    { value: "D", label: "D · AI 实测" },
  ];
  return (
    <VStack gap={4}>
      <ListToolbar>
        <HStack gap={3} wrap="wrap">
          <TextInput
            label="搜索导入结果"
            isLabelHidden
            type="search"
            placeholder="搜索记录序号或原因"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
          />
          <Selector
            label="导入结果"
            isLabelHidden
            value={outcome}
            options={[
              { value: "all", label: "全部结果" },
              { value: "added", label: "新增" },
              { value: "duplicate", label: "重复" },
              { value: "rejected", label: "拒绝" },
            ]}
            onChange={(value) => {
              setOutcome(value);
              setPage(1);
            }}
          />
        </HStack>
        <HStack gap={3} wrap="wrap">
          <Selector
            label="模板渠道"
            isLabelHidden
            value={channel}
            options={channels}
            onChange={setChannel}
          />
          <Button label="下载模板" onClick={downloadTemplate} />
          <Button label="字段说明" onClick={() => setDialog("fields")} />
          <Button
            label="导入 CSV"
            variant="primary"
            isDisabled={!session?.can_write || busy}
            tooltip={!session?.can_write ? "需策略角色登录后导入" : undefined}
            onClick={() => {
              setError("");
              setDialog("import");
            }}
          />
        </HStack>
      </ListToolbar>
      {report && (
        <HStack gap={4} wrap="wrap">
          <Text type="supporting">
            {reportContext?.industry} · {reportContext?.channel} 类
          </Text>
          <Text type="body">新增 {report.added}</Text>
          <Text type="body">重复 {report.duplicate}</Text>
          <Text type="body">拒绝 {report.rejected}</Text>
        </HStack>
      )}
      {view.items.length ? (
        <Table
          data={view.items}
          idKey="record_number"
          density="compact"
          columns={[
            { key: "record_number", header: "记录序号" },
            { key: "display_outcome", header: "结果" },
            { key: "display_reason", header: "拒绝原因" },
          ]}
        />
      ) : (
        <EmptyState title={report ? "没有匹配的记录" : "暂无导入结果"} />
      )}
      <ListFooter
        page={view.page}
        total={view.total}
        pageSize={10}
        onChange={setPage}
      />
      {report?.truncated && (
        <Text type="supporting">
          仅返回前 20 条明细；上方汇总包含全部记录。
        </Text>
      )}
      {message && <Text role="status">{message}</Text>}
      <FormDialog
        isOpen={dialog === "import"}
        title="导入 CSV"
        busy={busy}
        error={error}
        onClose={() => setDialog(null)}
        onSubmit={submit}
        submitLabel="确认导入"
        disabled={
          !session?.can_write ||
          !file ||
          !industry.trim() ||
          (channel === "C" && !authorization.trim())
        }
      >
        <TextInput
          label="行业"
          value={industry}
          onChange={setIndustry}
          isDisabled={Boolean(industryContext)}
          disabledMessage="行业随顶栏品牌切换"
          isRequired
        />
        <Selector
          label="来源渠道"
          value={channel}
          options={channels}
          onChange={setChannel}
        />
        {channel !== "C" ? (
          <TextInput
            label="文件来源标识（选填）"
            placeholder="如 google-trends-global-weekly-v1"
            value={sourceId}
            onChange={setSourceId}
          />
        ) : (
          <>
            <TextInput
              label="书面授权编号"
              value={authorization}
              onChange={setAuthorization}
              isRequired
            />
            <Text type="supporting">授权与脱敏配置需审核通过，否则拒收。</Text>
          </>
        )}
        <FileInput
          label="CSV 文件"
          value={file}
          onChange={(value) =>
            setFile(Array.isArray(value) ? (value[0] ?? null) : value)
          }
          accept=".csv,text/csv"
          maxSize={1048576}
          description="UTF-8，最大 1 MiB；请保留模板列名。"
          isDisabled={busy}
        />
      </FormDialog>
      <FormDialog
        isOpen={dialog === "fields"}
        title={`${channel} 类模板字段`}
        onClose={() => setDialog(null)}
      >
        <Table
          data={keywordImportFields(channel)}
          idKey="key"
          density="compact"
          columns={[
            { key: "key", header: "CSV 列名" },
            { key: "required", header: "是否必填" },
            { key: "description", header: "填写说明" },
          ]}
        />
      </FormDialog>
    </VStack>
  );
}
