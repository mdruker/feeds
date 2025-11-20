export function getCursor(
  date: Date,
  cid: string,
) {
  return new Date(date).getTime().toString(10) + ':' + cid
}

export function isCursor(cursor: string) {
  let strings = cursor.split(':')
  if (strings.length !== 2) {
    return false
  }
  return /^[0-9]+$/.test(strings[0])
    && /^[a-zA-Z0-9]+$/.test(strings[1]);
}