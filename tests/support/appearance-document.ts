// Minimal CSSOM/attribute boundary for component tests; no browser or layout.
export function appearanceDocument() {
  const properties = new Map<string, { value: string; priority: string }>();
  function attributes(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getAttribute: (name: string) => values.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        values.set(name, value);
      },
      removeAttribute: (name: string) => {
        values.delete(name);
      },
    };
  }
  const root = {
    ...attributes(),
    style: {
      getPropertyValue: (key: string) => properties.get(key)?.value ?? '',
      getPropertyPriority: (key: string) => properties.get(key)?.priority ?? '',
      setProperty: (key: string, value: string, priority = '') => {
        properties.set(key, { value, priority });
      },
      removeProperty: (key: string) => {
        properties.delete(key);
      },
    },
  };
  const themeColor = attributes({ content: '#ffffff' });
  return { root, themeColor };
}
