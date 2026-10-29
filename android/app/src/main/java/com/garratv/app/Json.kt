package com.garratv.app

/**
 * Minimal JSON writing for the bridges. Rows from the catalog can number in the
 * tens of thousands, and building org.json objects for each one is far slower
 * than appending straight into one buffer.
 */
object Json {
    fun quote(value: String, out: StringBuilder) {
        out.append('"')
        for (ch in value) {
            when (ch) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                // Valid JSON, but these end a line in JS source evaluated by evaluateJavascript.
                ' ' -> out.append("\\u2028")
                ' ' -> out.append("\\u2029")
                else -> if (ch < ' ') {
                    out.append(String.format("\\u%04x", ch.code))
                } else {
                    out.append(ch)
                }
            }
        }
        out.append('"')
    }

    fun quote(value: String): String = StringBuilder(value.length + 2).also { quote(value, it) }.toString()

    fun ok(result: String): String = "{\"result\":$result}"

    fun okString(result: String): String = ok(quote(result))

    fun error(message: String?, code: String): String {
        val out = StringBuilder("{\"error\":")
        quote(message ?: code, out)
        out.append(",\"code\":")
        quote(code, out)
        out.append('}')
        return out.toString()
    }
}
