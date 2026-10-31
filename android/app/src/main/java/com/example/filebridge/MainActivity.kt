package com.example.filebridge

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.TextView

class MainActivity : Activity() {

    private lateinit var output: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        output = TextView(this).apply {
            textSize = 18f
            setPadding(32, 48, 32, 32)
        }

        setContentView(output)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val uri: Uri? = intent?.data

        output.text = if (uri != null) {
            """
            INTENT RECEIVED

            Action:
            ${intent.action}

            Full URI:
            $uri

            Host:
            ${uri.host}

            Path:
            ${uri.path}

            Message:
            ${uri.getQueryParameter("message")}

            URL:
            ${uri.getQueryParameter("url")}
            """.trimIndent()
        } else {
            """
            FileBridge started.

            Waiting for HTTPS App Link...
            """.trimIndent()
        }
    }
}
