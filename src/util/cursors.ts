export function getCursor(
  date: Date,
  cid: string,
) {
  return new Date(date).getTime().toString(10) + ':' + cid
}