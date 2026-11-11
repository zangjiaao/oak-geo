import { randomUUID } from "node:crypto";
import { validation, permission } from "./errors.mjs";
import { required, conflict } from "./domain-common.mjs";
import {
  assertPublicRoot,
  privateMarkers,
  assertSharedMaintainer,
} from "./shared-industry.mjs";
import { pageQuery } from "./pagination.mjs";

const columns =
  "id,logical_id,previous_id,industry,word,word_type,maintainer,last_reviewed_at,seed_version,status,created_at";
const current =
  "NOT EXISTS(SELECT 1 FROM seed_list next WHERE next.previous_id=s.id)";
function validate(body) {
  required(body, [
    "industry",
    "word",
    "word_type",
    "maintainer",
    "last_reviewed_at",
  ]);
  for (const key of [
    "industry",
    "word",
    "word_type",
    "maintainer",
    "last_reviewed_at",
  ])
    if (typeof body[key] !== "string")
      throw validation("seed fields must be strings", { field: key });
  if (
    !body.last_reviewed_at.endsWith("Z") ||
    !Number.isFinite(Date.parse(body.last_reviewed_at))
  )
    throw validation("review timestamp must be UTC ISO-8601");
  if (
    Object.hasOwn(body, "status") &&
    !["active", "deprecated"].includes(body.status)
  )
    throw validation("status must be active or deprecated");
}
async function write(ctx, old) {
  const b = { ...old, ...ctx.body };
  validate(b);
  if (old && ctx.body.industry != null && ctx.body.industry !== old.industry)
    throw validation("revision cannot change industry");
  // Every editor supplies the reviewer and review instant; no hidden inheritance.
  required(ctx.body, ["maintainer", "last_reviewed_at"]);
  await ctx.client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    ["seed:" + b.industry],
  );
  if (
    old &&
    (
      await ctx.client.query("SELECT 1 FROM seed_list WHERE previous_id=$1", [
        old.id,
      ])
    ).rowCount
  )
    throw conflict("stale seed version; reload latest before revising");
  const markers = await privateMarkers(ctx.client);
  assertPublicRoot(b, ctx.publicRootCatalog, markers);
  assertSharedMaintainer(b.maintainer, markers);
  const version = Number(
    (
      await ctx.client.query(
        "SELECT coalesce(max(seed_version),0)+1 AS n FROM seed_list WHERE industry=$1",
        [b.industry],
      )
    ).rows[0].n,
  );
  const id = randomUUID();
  const matching = (
    await ctx.client.query(
      `SELECT s.id,s.logical_id FROM seed_list s WHERE industry=$1 AND word_type=$2 AND word=$3 AND ${current} ORDER BY seed_version DESC LIMIT 1`,
      [b.industry, b.word_type, b.word],
    )
  ).rows[0];
  if (old && matching && matching.logical_id !== old.logical_id)
    throw conflict("public root already has a current logical row");
  const root = old ?? matching;
  const row = (
    await ctx.client.query(
      `INSERT INTO seed_list(id,logical_id,previous_id,industry,word,word_type,maintainer,last_reviewed_at,seed_version,status,created_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${columns}`,
      [
        id,
        root?.logical_id ?? id,
        root?.id ?? null,
        b.industry,
        b.word,
        b.word_type,
        b.maintainer,
        b.last_reviewed_at,
        version,
        b.status ?? "active",
        new Date(ctx.now()).toISOString(),
      ],
    )
  ).rows[0];
  return { data: row };
}
export function seedHandlers() {
  return {
    "seed_list.create": (ctx) => write(ctx),
    "seed_list.revise": async (ctx) => {
      const old = (
        await ctx.client.query("SELECT * FROM seed_list WHERE id=$1", [
          ctx.params.id,
        ])
      ).rows[0];
      if (!old) throw permission("seed outside accessible shared plane");
      return write(ctx, old);
    },
    "seed_list.read": async (ctx) => {
      const industry = ctx.query.industry ?? "B2B";
      const words = [...ctx.publicRootCatalog]
        .filter((key) => key.startsWith(industry + "\0"))
        .map((key) => key.split("\0")[1]);
      const markers = await privateMarkers(ctx.client);
      if (
        ctx.query.status != null &&
        !["active", "deprecated"].includes(ctx.query.status)
      )
        throw validation("invalid seed status filter");
      if (
        ctx.query.view != null &&
        !["current", "history"].includes(ctx.query.view)
      )
        throw validation("invalid seed view");
      let where =
        "s.industry=$1 AND s.word=ANY($2::text[]) AND s.word_type=ANY($3::text[])";
      const values = [industry, words, ["品类", "场景", "问题"]];
      let currentFilter = current;
      if (ctx.query.seed_version != null) {
        const version = Number(ctx.query.seed_version);
        if (!Number.isSafeInteger(version) || version < 1)
          throw validation("seed_version must be a positive integer");
        values.push(version);
        where += ` AND s.seed_version<=$${values.length}`;
        currentFilter = `NOT EXISTS(SELECT 1 FROM seed_list next WHERE next.previous_id=s.id AND next.seed_version<=$${values.length})`;
      }
      if (ctx.query.view !== "history") where += " AND " + currentFilter;
      for (const key of ["logical_id", "status"])
        if (ctx.query[key] != null) {
          values.push(ctx.query[key]);
          where += ` AND s.${key}=$${values.length}`;
        }
      return {
        data: await pageQuery(ctx, {
          table: "seed_list s",
          columns: columns
            .split(",")
            .map((c) => "s." + c)
            .join(","),
          where,
          values,
          order: [
            ["s.seed_version", "ASC"],
            ["s.id", "ASC"],
          ],
          map: (row) => {
            assertPublicRoot(row, ctx.publicRootCatalog, markers);
            assertSharedMaintainer(row.maintainer, markers);
            return row;
          },
        }),
      };
    },
  };
}
