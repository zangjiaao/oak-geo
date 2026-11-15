"use client";
import { useRef, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Button } from "@astryxdesign/core/Button";
import { Table } from "@astryxdesign/core/Table";
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
export function CsvImportPanel({ session }: { session: Session }) {
  const [file, setFile] = useState<File | null>(null),
    [channel, setChannel] = useState("B"),
    [industry, setIndustry] = useState("B2B"),
    [authorization, setAuthorization] = useState("");
  const [report, setReport] = useState<Report | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{
    signature: string;
    key: string;
    body: string;
  } | null>(null);
  async function submit() {
    if (!file || !session) return;
    setBusy(true);
    setMessage("");
    setReport(null);
    try {
      const body = {
        industry,
        channel,
        csv: await file.text(),
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
      pending.current = null;
      setFile(null);
      setMessage("导入处理完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <VStack gap={4}>
      <Heading level={2}>CSV 导入</Heading>
      <Text type="supporting">
        CSV 需包含 keyword、collected_at 列；采集时间使用 UTC，例如
        2026-01-01T00:00:00Z。可选
        demand_index、trend_dir；同一时点的重复观测会去重，不同采集时间保留新观测。
      </Text>
      <HStack gap={4} wrap="wrap">
        <TextInput
          label="行业"
          value={industry}
          onChange={setIndustry}
          isRequired
        />
        <Selector
          label="来源渠道"
          value={channel}
          options={[
            { value: "A", label: "A · 检索类" },
            { value: "B", label: "B · 平台内" },
            { value: "C", label: "C · 自有一手" },
            { value: "D", label: "D · AI 实测" },
          ]}
          onChange={setChannel}
        />
      </HStack>
      {channel === "C" && (
        <>
          <TextInput
            label="书面授权编号"
            value={authorization}
            onChange={setAuthorization}
            isRequired
          />
          <Text type="supporting">
            C
            类需有效书面授权及已核验的姓名、地址脱敏词典；缺少配置会拒收。姓名、地址等身份列不入库，文本在入库前自动脱敏。
          </Text>
        </>
      )}
      <FileInput
        label="选择 CSV 文件"
        value={file}
        onChange={(value) => {
          setFile(Array.isArray(value) ? (value[0] ?? null) : value);
          setReport(null);
        }}
        accept=".csv,text/csv"
        maxSize={1048576}
        description="UTF-8 CSV，单批最多 1 MiB"
        isDisabled={!session?.can_write || busy}
        disabledMessage="需策略角色登录后导入"
      />
      <Button
        label="确认导入"
        variant="primary"
        isLoading={busy}
        isDisabled={
          !session?.can_write ||
          !file ||
          !industry.trim() ||
          (channel === "C" && !authorization.trim())
        }
        onClick={submit}
      />
      {message && (
        <Text type="body" role="status">
          {message}
        </Text>
      )}
      {report && (
        <>
          <HStack gap={4}>
            <Text type="body">新增 {report.added}</Text>
            <Text type="body">重复 {report.duplicate}</Text>
            <Text type="body">拒绝 {report.rejected}</Text>
          </HStack>
          <Table
            data={report.record_results.map((row) => ({
              ...row,
              code:
                row.code === "observation_conflict"
                  ? "同一时点的数据或出处冲突"
                  : row.code
                    ? "字段无效，请检查时间和指数等输入"
                    : "—",
              outcome:
                row.outcome === "added"
                  ? "新增"
                  : row.outcome === "duplicate"
                    ? "重复"
                    : "拒绝",
            }))}
            idKey="record_number"
            density="compact"
            columns={[
              { key: "record_number", header: "记录序号" },
              { key: "outcome", header: "结果" },
              { key: "code", header: "拒绝原因" },
            ]}
          />
          {report.truncated && (
            <Text type="supporting">
              展示前20条处理结果；汇总计数覆盖整批，不回显拒绝行原文。
            </Text>
          )}
        </>
      )}
    </VStack>
  );
}
