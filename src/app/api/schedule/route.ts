import { DateTime } from "luxon";
import { Timestamp } from "firebase-admin/firestore";
import {
  authorize,
  admin,
  encode,
  failure,
  HttpError,
} from "@/server/firebase";
export async function GET(req: Request) {
  try {
    const user = await authorize(req),
      url = new URL(req.url),
      from = DateTime.fromISO(url.searchParams.get("from") || "", {
        setZone: true,
      }),
      to = DateTime.fromISO(url.searchParams.get("to") || "", {
        setZone: true,
      });
    if (
      !from.isValid ||
      !to.isValid ||
      to <= from ||
      to.diff(from, "days").days > 93
    )
      throw new HttpError(400, "조회 기간은 최대 93일입니다");
    const collection = admin().db.collection(`users/${user.uid}/tasks`);
    const timedOnly = url.searchParams.get("timedOnly") === "true";
    const snapshots = await Promise.all([
      ...(!timedOnly ? [collection
        .where("deleted", "==", false)
        .where("dueDate", ">=", from.toISODate())
        .where("dueDate", "<", to.toISODate())
        .limit(501)
        .get()] : []),
      collection
        .where("deleted", "==", false)
        .where("startAt", "<", Timestamp.fromDate(to.toJSDate()))
        .where("endAt", ">", Timestamp.fromDate(from.toJSDate()))
        .limit(501)
        .get(),
      ...(!timedOnly ? [collection
        .where("deleted", "==", false)
        .where("startAt", "==", null)
        .limit(501)
        .get()] : []),
    ]);
    if (snapshots.some((s) => s.size > 500))
      throw new HttpError(
        400,
        "조회 항목이 500개를 넘었습니다. 모든 할 일에서 목록을 정리하거나 더 짧은 기간을 선택하세요",
      );
    const items = new Map<string, unknown>();
    for (const snap of snapshots)
      for (const doc of snap.docs) {
        if (doc.data().uid !== user.uid)
          throw new HttpError(403, "소유권 오류");
        items.set(doc.id, { id: doc.id, ...encode(doc.data()) });
      }
    return Response.json({ items: [...items.values()] });
  } catch (e) {
    return failure(e);
  }
}
