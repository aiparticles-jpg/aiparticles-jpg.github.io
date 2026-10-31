
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
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

import org.json.JSONObject

import java.net.URL
import java.net.URLConnection
import java.net.URLDecoder
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private lateinit var output: TextView
    private lateinit var downloadButton: Button

    private val executor = Executors.newSingleThreadExecutor()
    private val httpClient = OkHttpClient()

    private var sourceUrl: String? = null
    private var folderId: String? = null
    private var requestedFilename: String? = null

    companion object {
        private const val REQUEST_AUTHORIZATION = 1001
        private const val DRIVE_SCOPE =
            "https://www.googleapis.com/auth/drive"
        private const val MAX_DOWNLOAD_BYTES = 100L * 1024L * 1024L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        output = TextView(this).apply {
            textSize = 15f
            setPadding(24, 24, 24, 24)
        }

        downloadButton = Button(this).apply {
            text = "Download to Google Drive"
            setOnClickListener {
                startDownload()
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

            addView(downloadButton)
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
        val uri = intent?.data

        sourceUrl = uri?.getQueryParameter("url")
        folderId = uri?.getQueryParameter("folder_id")
        requestedFilename = uri?.getQueryParameter("filename")

        val validUrl = sourceUrl?.let {
            try {
                val parsed = Uri.parse(it)
                parsed.scheme == "https" || parsed.scheme == "http"
            } catch (_: Exception) {
                false
            }
        } == true

        val validFolder = !folderId.isNullOrBlank()

        downloadButton.isEnabled = validUrl && validFolder

        output.text = """
            FILEBRIDGE

            Source URL:
            ${sourceUrl ?: "(missing)"}

            Destination folder ID:
            ${folderId ?: "(missing)"}

            Filename:
            ${requestedFilename ?: "(automatic)"}

            Status:
            ${if (validUrl && validFolder) {
                "Ready to download."
            } else {
                "A valid URL and folder_id are required."
            }}
        """.trimIndent()
    }

    private fun startDownload() {
        downloadButton.isEnabled = false
        output.text = "Requesting Google Drive authorization..."

        val request = AuthorizationRequest.builder()
            .setRequestedScopes(listOf(Scope(DRIVE_SCOPE)))
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
                    continueWithToken(result.accessToken)
                }
            }
            .addOnFailureListener { e ->
                showError("Authorization failed", e)
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
            showError("Authorization cancelled", Exception("No authorization result"))
            return
        }

        try {
            val result =
                Identity.getAuthorizationClient(this)
                    .getAuthorizationResultFromIntent(data)

            continueWithToken(result.accessToken)

        } catch (e: Exception) {
            showError("Could not retrieve access token", e)
        }
    }

    private fun continueWithToken(token: String?) {
        if (token.isNullOrBlank()) {
            showError("Empty access token", Exception("Google returned no token"))
            return
        }

        val url = sourceUrl ?: return showError(
            "Missing source URL",
            Exception("The App Link has no url parameter")
        )

        val folder = folderId ?: return showError(
            "Missing folder ID",
            Exception("The App Link has no folder_id parameter")
        )

        val filename = requestedFilename

        output.text = "Downloading file..."

        executor.execute {
            try {
                val downloaded = downloadFile(url, filename)
                val result = uploadToDrive(
                    token,
                    folder,
                    downloaded.first,
                    downloaded.second
                )

                runOnUiThread {
                    output.text = """
                        SUCCESS

                        Filename:
                        ${downloaded.first}

                        Drive file ID:
                        ${result.first}

                        Operation:
                        ${result.second}
                    """.trimIndent()

                    downloadButton.isEnabled = true
                }

            } catch (e: Exception) {
                runOnUiThread {
                    showError("Download or upload failed", e)
                }
            }
        }
    }

    private fun downloadFile(
        source: String,
        explicitFilename: String?
    ): Pair<String, ByteArray> {

        val connection = URL(source).openConnection().apply {
            connectTimeout = 30000
            readTimeout = 60000
            instanceFollowRedirects = true
        }

        connection.connect()

        val statusConnection = connection as? java.net.HttpURLConnection
        val status = statusConnection?.responseCode

        if (status != null && status !in 200..299) {
            throw Exception("Source server returned HTTP $status")
        }

        val disposition = connection.getHeaderField("Content-Disposition")
        val filename = determineFilename(explicitFilename, disposition, source)

        val length = connection.contentLengthLong
        if (length > MAX_DOWNLOAD_BYTES) {
            throw Exception("File exceeds 100 MB limit")
        }

        val bytes = BufferedInputStream(connection.getInputStream()).use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            var total = 0L

            while (true) {
                val count = input.read(buffer)
                if (count == -1) break

                total += count
                if (total > MAX_DOWNLOAD_BYTES) {
                    throw Exception("File exceeds 100 MB limit")
                }

                output.write(buffer, 0, count)
            }

            output.toByteArray()
        }

        statusConnection?.disconnect()

        if (bytes.isEmpty()) {
            throw Exception("Downloaded file is empty")
        }

        return Pair(filename, bytes)
    }

    private fun determineFilename(
        explicit: String?,
        disposition: String?,
        source: String
    ): String {

        val candidate = explicit?.takeIf { it.isNotBlank() }
            ?: extractDispositionFilename(disposition)
            ?: extractUrlFilename(source)
            ?: throw Exception("Could not determine filename")

        val safe = candidate.substringAfterLast('/')
            .substringAfterLast('\\')
            .trim()

        if (safe.isBlank() || safe == "." || safe == "..") {
            throw Exception("Invalid filename")
        }

        if (safe.any { it.code < 32 || it in "<>:\"|?*" }) {
            throw Exception("Filename contains invalid characters")
        }

        return safe
    }

    private fun extractDispositionFilename(value: String?): String? {
        if (value.isNullOrBlank()) return null

        val encoded = Regex(
            """filename\*\s*=\s*UTF-8''([^;]+)""",
            RegexOption.IGNORE_CASE
        ).find(value)?.groupValues?.get(1)

        if (encoded != null) {
            return try {
                URLDecoder.decode(encoded, "UTF-8")
            } catch (_: Exception) {
                null
            }
        }

        val regular = Regex(
            """filename\s*=\s*"?([^";]+)"?""",
            RegexOption.IGNORE_CASE
        ).find(value)?.groupValues?.get(1)

        return regular?.trim()
    }

    private fun extractUrlFilename(source: String): String? {
        val path = Uri.parse(source).lastPathSegment ?: return null

        return try {
            URLDecoder.decode(path, "UTF-8")
        } catch (_: Exception) {
            path
        }.takeIf { it.isNotBlank() }
    }

    private fun uploadToDrive(
        token: String,
        folderId: String,
        filename: String,
        bytes: ByteArray
    ): Pair<String, String> {

        val escapedName = filename.replace("\\", "\\\\")
            .replace("'", "\\'")

        val escapedFolder = folderId.replace("\\", "\\\\")
            .replace("'", "\\'")

        val query = "name = '$escapedName' and '$escapedFolder' in parents and trashed = false"

        val searchUrl = "https://www.googleapis.com/drive/v3/files" +
            "?q=${Uri.encode(query)}" +
            "&fields=files(id,name,mimeType,parents)" +
            "&pageSize=100"

        val searchRequest = Request.Builder()
            .url(searchUrl)
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        val searchJson = executeJson(searchRequest)
        val files = searchJson.optJSONArray("files")
            ?: throw Exception("Invalid Drive search response")

        if (files.length() > 1) {
            throw Exception(
                "Multiple files named '$filename' exist in the destination folder"
            )
        }

        val body = bytes.toRequestBody(
            "application/octet-stream".toMediaType()
        )

        if (files.length() == 1) {
            val fileId = files.getJSONObject(0).getString("id")

            val updateRequest = Request.Builder()
                .url(
                    "https://www.googleapis.com/upload/drive/v3/files/" +
                        "$fileId?uploadType=media"
                )
                .header("Authorization", "Bearer $token")
                .patch(body)
                .build()

            executeJson(updateRequest)

            return Pair(fileId, "Existing file updated")
        }

        val metadata = JSONObject().apply {
            put("name", filename)
            put("parents", org.json.JSONArray().put(folderId))
        }

        val boundary = "FileBridgeBoundary123456"

        val multipart = (
            "--$boundary\r\n" +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            metadata.toString() + "\r\n" +
            "--$boundary\r\n" +
            "Content-Type: application/octet-stream\r\n\r\n"
        ).toByteArray(Charsets.UTF_8) + bytes +
            "\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8)

        val createRequest = Request.Builder()
            .url(
                "https://www.googleapis.com/upload/drive/v3/files" +
                    "?uploadType=multipart&fields=id,name"
            )
            .header("Authorization", "Bearer $token")
            .post(
                multipart.toRequestBody(
                    "multipart/related; boundary=$boundary".toMediaType()
                )
            )
            .build()

        val created = executeJson(createRequest)
        return Pair(created.getString("id"), "New file created")
    }

    private fun executeJson(request: Request): JSONObject {
        httpClient.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()

            if (!response.isSuccessful) {
                throw Exception(
                    "Google Drive HTTP ${response.code}: $text"
                )
            }

            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun showError(message: String, error: Exception) {
        downloadButton.isEnabled = true

        output.text = """
            $message

            ${error.javaClass.simpleName}:
            ${error.message ?: "No additional details"}
        """.trimIndent()
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }
}
