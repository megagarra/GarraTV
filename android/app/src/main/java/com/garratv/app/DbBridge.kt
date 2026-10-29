package com.garratv.app

import android.webkit.JavascriptInterface
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * `window.GarraTVDb`: synchronous SQLite for the web layer's better-sqlite3 shim
 * (android/web/shims/better-sqlite3.ts). JS blocks on each call, exactly like
 * better-sqlite3 does in Node, so the server stores run unchanged.
 */
class DbBridge(private val dataDir: File) {
    private val driver = BundledSQLiteDriver()
    private val connections = mutableListOf<Connection>()

    private class Connection(val sqlite: SQLiteConnection) {
        /** Prepared statements reused across calls; the hot ones run thousands of times per sync. */
        val statements = object : LinkedHashMap<String, SQLiteStatement>(64, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, SQLiteStatement>): Boolean {
                if (size <= 128) return false
                eldest.value.close()
                return true
            }
        }

        fun statement(sql: String): SQLiteStatement =
            statements.getOrPut(sql) { sqlite.prepare(sql) }
    }

    @JavascriptInterface
    @Synchronized
    fun open(name: String): Int = try {
        require(name.matches(Regex("^[A-Za-z0-9._-]+$"))) { "Invalid database name" }
        dataDir.mkdirs()
        connections += Connection(driver.open(File(dataDir, name).absolutePath))
        connections.size - 1
    } catch (error: Exception) {
        -1
    }

    @JavascriptInterface
    @Synchronized
    fun exec(handle: Int, sql: String): String = guard {
        val connection = connections[handle]
        for (statement in splitStatements(sql)) {
            connection.sqlite.prepare(statement).use { prepared -> while (prepared.step()) Unit }
        }
        Json.ok("null")
    }

    @JavascriptInterface
    @Synchronized
    fun query(handle: Int, sql: String, paramsJson: String, mode: String): String = guard {
        val connection = connections[handle]
        val statement = connection.statement(sql)
        try {
            bind(statement, JSONArray(paramsJson))
            when (mode) {
                "run" -> {
                    while (statement.step()) Unit
                    statement.reset()
                    val info = connection.statement("SELECT changes(), last_insert_rowid()")
                    try {
                        info.step()
                        Json.ok("{\"changes\":${info.getLong(0)},\"lastInsertRowid\":${info.getLong(1)}}")
                    } finally {
                        info.reset()
                    }
                }
                "get" -> Json.ok(if (statement.step()) row(statement) else "null")
                else -> {
                    val out = StringBuilder("[")
                    var first = true
                    while (statement.step()) {
                        if (!first) out.append(',')
                        first = false
                        out.append(row(statement))
                    }
                    Json.ok(out.append(']').toString())
                }
            }
        } finally {
            statement.reset()
            statement.clearBindings()
        }
    }

    private inline fun guard(block: () -> String): String = try {
        block()
    } catch (error: Throwable) {
        val message = error.message ?: error.toString()
        val code = when {
            message.contains("constraint", ignoreCase = true) -> "SQLITE_CONSTRAINT"
            message.contains("busy", ignoreCase = true) -> "SQLITE_BUSY"
            else -> "SQLITE_ERROR"
        }
        Json.error(message, code)
    }

    private fun bind(statement: SQLiteStatement, params: JSONArray) {
        for (index in 0 until params.length()) {
            val position = index + 1
            when (val value = params.get(index)) {
                JSONObject.NULL -> statement.bindNull(position)
                is Int -> statement.bindLong(position, value.toLong())
                is Long -> statement.bindLong(position, value)
                is Double -> statement.bindDouble(position, value)
                is Number -> statement.bindDouble(position, value.toDouble())
                is Boolean -> statement.bindLong(position, if (value) 1 else 0)
                else -> statement.bindText(position, value.toString())
            }
        }
    }

    private fun row(statement: SQLiteStatement): String {
        val out = StringBuilder("{")
        for (column in 0 until statement.getColumnCount()) {
            if (column > 0) out.append(',')
            Json.quote(statement.getColumnName(column), out)
            out.append(':')
            when (statement.getColumnType(column)) {
                TYPE_INTEGER -> out.append(statement.getLong(column))
                TYPE_FLOAT -> {
                    val value = statement.getDouble(column)
                    if (value.isFinite()) out.append(value) else out.append("null")
                }
                TYPE_NULL -> out.append("null")
                TYPE_BLOB -> out.append("null")
                else -> Json.quote(statement.getText(column), out)
            }
        }
        return out.append('}').toString()
    }

    /** Splits a script on `;` outside quotes and comments (the schemas have no triggers). */
    private fun splitStatements(sql: String): List<String> {
        val statements = mutableListOf<String>()
        val current = StringBuilder()
        var index = 0
        while (index < sql.length) {
            val ch = sql[index]
            when {
                ch == '\'' || ch == '"' || ch == '`' -> {
                    val end = sql.indexOf(ch, index + 1).let { if (it == -1) sql.length - 1 else it }
                    current.append(sql, index, end + 1)
                    index = end + 1
                    continue
                }
                ch == '-' && sql.startsWith("--", index) -> {
                    val end = sql.indexOf('\n', index).let { if (it == -1) sql.length else it }
                    index = end
                    continue
                }
                ch == '/' && sql.startsWith("/*", index) -> {
                    val end = sql.indexOf("*/", index + 2).let { if (it == -1) sql.length else it + 2 }
                    index = end
                    continue
                }
                ch == ';' -> {
                    current.toString().trim().takeIf { it.isNotEmpty() }?.let(statements::add)
                    current.setLength(0)
                }
                else -> current.append(ch)
            }
            index++
        }
        current.toString().trim().takeIf { it.isNotEmpty() }?.let(statements::add)
        return statements
    }

    private companion object {
        // androidx.sqlite column type codes (SQLITE_INTEGER … SQLITE_NULL).
        const val TYPE_INTEGER = 1
        const val TYPE_FLOAT = 2
        const val TYPE_BLOB = 4
        const val TYPE_NULL = 5
    }
}
