
package com.example.filebridge

import android.app.Activity
import android.content.Intent
import android.content.IntentSender
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

class MainActivity : Activity() {

    private lateinit var output: TextView
    private lateinit var authorizeButton: Button

    private var currentUri: Uri? = null

    companion object {
        private const val REQUEST_AUTHORIZATION = 1001
        private const val DRIVE_SCOPE =
            "https://www.googleapis.com/auth/drive"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        output = TextView(this).apply {
            textSize = 15f
            setPadding(24, 24, 24, 24)
        }

        authorizeButton = Button(this).apply {
            text = "Authorize Google Drive"
            setOnClickListener {
                requestDriveAuthorization()
            }
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16, 16, 16, 16)

            addView(
                ScrollView(this@MainActivity).apply {
                    addView(output)
                },
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    0,
                    1f
                )
            )

            addView(authorizeButton)
        }

        setContentView(layout)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        currentUri = intent?.data

        val uri = currentUri

        output.text = if (uri != null) {
            """
            FILEBRIDGE

            App Link received.

            URL:
            ${uri.getQueryParameter("url") ?: "(not provided)"}

            Folder ID:
            ${uri.getQueryParameter("folder_id") ?: "(not provided)"}

            Filename:
            ${uri.getQueryParameter("filename") ?: "(automatic)"}

            Ready to test Google Drive authorization.
            """.trimIndent()
        } else {
            """
            FILEBRIDGE

            Waiting for an HTTPS App Link.

            You can test Google Drive authorization below.
            """.trimIndent()
        }
    }

    private fun requestDriveAuthorization() {
        authorizeButton.isEnabled = false
        output.text = "Requesting Google Drive authorization..."

        val request = AuthorizationRequest.builder()
            .setRequestedScopes(
                listOf(Scope(DRIVE_SCOPE))
            )
            .build()

        Identity.getAuthorizationClient(this)
            .authorize(request)
            .addOnSuccessListener { result ->
                if (result.hasResolution()) {
                    try {
                        startIntentSenderForResult(
                            result.pendingIntent!!.intentSender,
                            REQUEST_AUTHORIZATION,
                            null,
                            0,
                            0,
                            0
                        )
                    } catch (e: IntentSender.SendIntentException) {
                        showError("Could not open authorization screen", e)
                    }
                } else {
                    handleAuthorizationSuccess(result.accessToken)
                }
            }
            .addOnFailureListener { e ->
                showError("Authorization request failed", e)
            }
    }

    @Deprecated("Using startIntentSenderForResult for compatibility")
    override fun onActivityResult(
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode != REQUEST_AUTHORIZATION) return

        if (resultCode != RESULT_OK || data == null) {
            authorizeButton.isEnabled = true
            output.text = "Google Drive authorization was cancelled."
            return
        }

        try {
            val result =
                Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(data)

            handleAuthorizationSuccess(result.accessToken)

        } catch (e: Exception) {
            showError("Could not retrieve authorization result", e)
        }
    }

    private fun handleAuthorizationSuccess(accessToken: String?) {
        authorizeButton.isEnabled = true

        if (accessToken.isNullOrBlank()) {
            output.text = "Authorization returned an empty access token."
            return
        }

        // Do not display or log the access token.
        output.text = """
            GOOGLE DRIVE AUTHORIZATION SUCCESSFUL

            FileBridge received an access token.

            The token is not displayed or saved.

            Google Drive authorization test passed.
        """.trimIndent()

        authorizeButton.text = "Authorization successful"
    }

    private fun showError(message: String, error: Exception) {
        authorizeButton.isEnabled = true

        output.text = """
            $message

            ${error.javaClass.simpleName}:
            ${error.message ?: "No additional details"}
        """.trimIndent()
    }
}
