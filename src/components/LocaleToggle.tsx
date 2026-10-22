import { SegmentedControl } from "@mantine/core";
import type { Locale, t } from "../i18n";

type Props = {
  locale: Locale;
  onChange: (l: Locale) => void;
  m: ReturnType<typeof t>;
};

export function LocaleToggle({ locale, onChange, m }: Props) {
  return (
    <SegmentedControl
      size="xs"
      value={locale}
      onChange={(value) => onChange(value as Locale)}
      data={[
        { label: m.langZh, value: "zh" },
        { label: m.langEn, value: "en" },
      ]}
    />
  );
}
