import { Group, Text } from "@mantine/core";
import { LocaleToggle } from "./LocaleToggle";
import type { Locale, t } from "../i18n";

type Props = {
  title: string;
  subtitle?: string;
  locale: Locale;
  onLocale: (l: Locale) => void;
  m: ReturnType<typeof t>;
};

export function Header({ title, subtitle, locale, onLocale, m }: Props) {
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <div>
        <Text fw={600} size="sm">
          {title}
        </Text>
        {subtitle && (
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        )}
      </div>
      <LocaleToggle locale={locale} onChange={onLocale} m={m} />
    </Group>
  );
}
