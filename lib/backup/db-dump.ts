/**
 * SQL dump of the whole MySQL database, gzipped in memory.
 *
 * WHY mysql2 and not Prisma: we need every value exactly as MySQL stores it
 * (DATETIME precision, DECIMAL, JSON text, binary). Every non-binary value is
 * read as the server's own text, so nothing is re-formatted by JavaScript.
 *
 * WHY raw tables (SHOW TABLES) and not Prisma models: a table added later is
 * backed up automatically, including `_prisma_migrations`.
 *
 * Consistency: all SELECTs run inside one REPEATABLE READ snapshot
 * (same as `mysqldump --single-transaction`).
 *
 * The file ends with a manifest (`-- ROWCOUNT <table> <n>`) taken from the same
 * snapshot; scripts/restore-test.ps1 compares a restored copy against it.
 */

import mysql from 'mysql2'
import type { Connection, FieldPacket } from 'mysql2'
import { createGzip } from 'zlib'

export interface DumpTableInfo {
  name: string
  rows: number
}

export interface DumpResult {
  gz: Buffer
  rawBytes: number
  tables: DumpTableInfo[]
  createdAt: Date
  durationMs: number
}

const INSERT_BATCH_ROWS = 200
const INSERT_BATCH_BYTES = 512 * 1024

// information_schema DATA_TYPE values
const BINARY_DATA_TYPES = new Set(['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob', 'bit', 'geometry', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometrycollection'])
const NUMERIC_DATA_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real', 'year'])

function connectionConfigFromUrl(databaseUrl: string) {
  // Parse ourselves: Prisma URLs may carry query params mysql2 does not understand.
  const url = new URL(databaseUrl)
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  }
}

function query<T = unknown>(conn: Connection, sql: string): Promise<T> {
  return new Promise((resolve, reject) => {
    conn.query(sql, (err, result) => (err ? reject(err) : resolve(result as T)))
  })
}

function quoteIdent(name: string) {
  return '`' + name.replace(/`/g, '``') + '`'
}

function sqlValue(value: unknown, numeric: boolean): string {
  if (value === null || value === undefined) return 'NULL'
  if (Buffer.isBuffer(value)) return value.length ? `0x${value.toString('hex')}` : `X''`
  const text = String(value)
  if (numeric && /^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(text)) return text
  return mysql.escape(text)
}

export async function createSqlDump(options: { deadlineMs?: number } = {}): Promise<DumpResult> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')

  const started = Date.now()
  const deadline = options.deadlineMs ? started + options.deadlineMs : Infinity
  const createdAt = new Date()
  const config = connectionConfigFromUrl(databaseUrl)

  // "table.column" keys; filled before any SELECT * runs.
  const binaryColumns = new Set<string>()
  const numericColumns = new Set<string>()

  const conn = mysql.createConnection({
    ...config,
    charset: 'utf8mb4',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    rowsAsArray: true,
    typeCast(field) {
      if (binaryColumns.has(`${field.table}.${field.name}`)) return field.buffer()
      return field.string('utf8')
    },
  })

  const gzip = createGzip({ level: 9 })
  const chunks: Buffer[] = []
  gzip.on('data', (c: Buffer) => chunks.push(c))
  const gzipDone = new Promise<void>((resolve, reject) => {
    gzip.on('end', resolve)
    gzip.on('error', reject)
  })

  let rawBytes = 0
  const write = async (text: string) => {
    rawBytes += Buffer.byteLength(text)
    if (!gzip.write(text)) await new Promise((r) => gzip.once('drain', r))
  }

  const tables: DumpTableInfo[] = []

  try {
    await query(conn, "SET SESSION time_zone = '+00:00'")
    await query(conn, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await query(conn, 'START TRANSACTION WITH CONSISTENT SNAPSHOT')

    const tableRows = await query<unknown[][]>(conn, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
    const tableNames = tableRows.map((r) => String(r[0])).sort()

    const columnRows = await query<unknown[][]>(
      conn,
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${mysql.escape(config.database)}`
    )
    for (const [tableName, columnName, dataType] of columnRows) {
      const key = `${String(tableName)}.${String(columnName)}`
      const type = String(dataType).toLowerCase()
      if (BINARY_DATA_TYPES.has(type)) binaryColumns.add(key)
      if (NUMERIC_DATA_TYPES.has(type)) numericColumns.add(key)
    }

    await write(
      [
        '-- TechNova SQL backup',
        `-- Created: ${createdAt.toISOString()}`,
        `-- Database: ${config.database}`,
        `-- Tables: ${tableNames.length}`,
        '',
        '/*!40101 SET NAMES utf8mb4 */;',
        "SET time_zone = '+00:00';",
        'SET FOREIGN_KEY_CHECKS = 0;',
        'SET UNIQUE_CHECKS = 0;',
        "SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
        '',
      ].join('\n') + '\n'
    )

    for (const table of tableNames) {
      if (Date.now() > deadline) throw new Error(`Backup ran out of time while dumping ${table}`)

      const createRows = await query<unknown[][]>(conn, `SHOW CREATE TABLE ${quoteIdent(table)}`)
      await write(`\n-- Table ${table}\nDROP TABLE IF EXISTS ${quoteIdent(table)};\n${String(createRows[0][1])};\n`)

      let fields: FieldPacket[] = []
      let rowCount = 0
      let batch: string[] = []
      let batchBytes = 0
      let insertPrefix = ''

      const flush = async () => {
        if (!batch.length) return
        await write(`${insertPrefix}\n${batch.join(',\n')};\n`)
        batch = []
        batchBytes = 0
      }

      const q = conn.query(`SELECT * FROM ${quoteIdent(table)}`)
      q.on('fields', (f: FieldPacket[]) => {
        fields = f
        insertPrefix = `INSERT INTO ${quoteIdent(table)} (${f.map((x) => quoteIdent(x.name)).join(', ')}) VALUES`
      })

      for await (const row of q.stream({ highWaterMark: 500 }) as AsyncIterable<unknown[]>) {
        const values = row.map((v, i) => sqlValue(v, numericColumns.has(`${table}.${fields[i]?.name}`)))
        const tuple = `(${values.join(',')})`
        batch.push(tuple)
        batchBytes += tuple.length
        rowCount++
        if (batch.length >= INSERT_BATCH_ROWS || batchBytes >= INSERT_BATCH_BYTES) await flush()
      }
      await flush()

      tables.push({ name: table, rows: rowCount })
    }

    await query(conn, 'COMMIT')

    await write(
      '\nSET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n\n-- Manifest (row counts from the same snapshot)\n' +
        tables.map((t) => `-- ROWCOUNT ${t.name} ${t.rows}`).join('\n') +
        `\n-- Dump completed ${new Date().toISOString()}\n`
    )
  } catch (error) {
    gzip.destroy()
    conn.destroy()
    throw error
  }
  conn.end()

  gzip.end()
  await gzipDone

  return {
    gz: Buffer.concat(chunks),
    rawBytes,
    tables,
    createdAt,
    durationMs: Date.now() - started,
  }
}
