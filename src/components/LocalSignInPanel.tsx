"use client";
import { useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

export function LocalSignInPanel() {
  const [status, setStatus] = useState(
    "在终端运行 npm run dev:login，打开输出的登录链接。",
  );
  useEffect(() => {
    function exchangeFragment() {
      const credential = new URLSearchParams(window.location.hash.slice(1)).get(
        "session",
      );
      if (!credential) return;
      // Remove the bearer fragment before any asynchronous request or redirect.
      window.history.replaceState(null, "", window.location.pathname);
      setStatus("正在登录…");
      void fetch("/api/local-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error?.message ?? "登录失败，请重新运行 npm run dev:login。",
            );
          // Fixed destination; never follow a user-supplied return URL.
          window.location.replace(
            "/library/questions?brand=fixture-jianzao-brand&industry=B2B",
          );
        })
        .catch((error) => setStatus(error.message));
    }
    exchangeFragment();
    window.addEventListener("hashchange", exchangeFragment);
    return () => window.removeEventListener("hashchange", exchangeFragment);
  }, []);
  return (
    <VStack gap={3}>
      <Text type="body" role="status">{status}</Text>
      <Text type="supporting">本地演示账号；数据为虚构验收样本。</Text>
    </VStack>
  );
}
