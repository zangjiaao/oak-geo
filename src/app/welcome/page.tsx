import { headers } from "next/headers";
import { Center } from "@astryxdesign/core/Center";
import { VStack } from "@astryxdesign/core/Stack";
import { Section } from "@astryxdesign/core/Section";
import { BrandProfileForm } from "@/components/ProductOnboarding";
import { readWorkbenchSession } from "@/server/api/worker-runtime.mjs";
import { selectWorkspace } from "@/lib/workspace-navigation.mjs";
export const dynamic = "force-dynamic";
// Adapted from Astryx contact-form: retain centered full-width stack and form spacing.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await readWorkbenchSession(await headers()),
    selection = selectWorkspace(session, await searchParams);
  return (
    <Center axis="horizontal">
      <VStack hAlign="center" width="100%">
        <Section maxWidth={800} padding={6} paddingBlock={10} variant="section">
          <BrandProfileForm
            key={selection.brand?.id}
            session={session}
            brandId={selection.valid ? (selection.brand?.id ?? null) : null}
            welcome
          />
        </Section>
      </VStack>
    </Center>
  );
}
