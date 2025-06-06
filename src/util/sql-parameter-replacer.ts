export function replaceNumberedParams(query: string, params?: any[]): string {
  return query.replace(/\$(\d+)/g, (match, paramNum) => {
    const index = parseInt(paramNum) - 1;

    if (params && params[index] !== undefined) {
      return formatValue(params[index]);
    }

    // Use default based on parameter position
    return 'sample_string';
  });
}

function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    // Escape single quotes and wrap in quotes
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (typeof value === 'boolean') {
    return value.toString();
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }

  return value.toString();
}