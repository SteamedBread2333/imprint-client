import { Modal, SimpleGrid, Stack, Text } from "@mantine/core";
import type { Messages } from "../../../i18n";
import { EdgeSample } from "./GraphLegend";

export function AuditHelp({ opened, onClose, m }: { opened: boolean; onClose: () => void; m: Messages }) {
  return (
    <Modal opened={opened} onClose={onClose} title={m.helpTitle} size="lg" centered>
      <Stack gap="md">
        <Text size="sm">{m.helpLead}</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <section>
            <Text fw={600} size="sm">{m.helpFilters}</Text>
            <Text size="sm" c="dimmed">{m.helpFiltersBody}</Text>
          </section>
          <section>
            <Text fw={600} size="sm">{m.helpGraph}</Text>
            <Text size="sm" c="dimmed">{m.helpGraphBody}</Text>
          </section>
          <section data-testid="audit-help-lines">
            <Text fw={600} size="sm" mb={6}>{m.helpLines}</Text>
            <Stack gap={6}>
              <EdgeSample kind="supersedes" label={m.edgeSupersedes} />
              <EdgeSample kind="related" label={m.edgeRelated} />
              <EdgeSample kind="conflicts_with" label={m.edgeConflict} />
              <EdgeSample kind="sources" label={m.edgeSources} />
              <EdgeSample kind="cited_by" label={m.edgeCited} />
              <EdgeSample kind="contains" label={m.edgeStructure} />
            </Stack>
            <Text size="sm" c="dimmed" mt={6}>{m.helpLinesBody}</Text>
          </section>
          <section>
            <Text fw={600} size="sm">{m.helpLabels}</Text>
            <Text size="sm" c="dimmed">{m.helpLabelsBody}</Text>
            <Text fw={600} size="sm" mt="sm">{m.helpKeys}</Text>
            <Text size="sm" c="dimmed">{m.helpKeysBody}</Text>
          </section>
        </SimpleGrid>
      </Stack>
    </Modal>
  );
}
