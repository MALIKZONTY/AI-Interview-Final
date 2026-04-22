# CHAPTER 7
# TESTING

## 7. TESTING

### 7.1 Introduction
Software testing of the AI Interview Platform is a systematic and rigorous process aimed at ensuring that the application efficiently handles complex, multi-modal workloads—such as live video capture, heavy audio processing, and extensive mathematical natural language evaluation—without compromising security or user experience. Testing allows project evaluators to gain an objective view of how reliably the custom Python Computer Vision modules interact with the Node.js API, verifying that the asynchronous architecture prevents server blocking while maintaining strict data integrity across the PostgreSQL relational databases.

The testing process evaluates whether the AI Interview Platform satisfies all functionality targets across several core modalities:

#### 7.1.1 Unit Testing
Individual backend functions, frontend React hooks, and standalone Python mathematical modules are tested in isolation. This includes testing the JWT signature validation, the asynchronous video-chunk buffering via `MediaRecorder`, and the specific Python calculations utilizing NumPy to track facial coordinates. Each unit is strictly verified to produce deterministic outputs before being allowed into the primary API pipeline.

#### 7.1.2 Integration Testing
Integration testing validates the asynchronous pipeline end-to-end. We systematically ensured that a WebRTC video blob submitted from the React UI successfully passes the Node.js Express router, successfully spawns the Python analyzer, successfully records the mathematical confidence metrics, and successfully persists that unstructured evaluation data back into the `interview_feedback` PostgreSQL table without any data loss or connection timeouts.

#### 7.1.3 Security and Payload Testing
Security testing aggressively targets the stateless authentication mechanism and file ingestion vulnerabilities. Controlled simulations attempt to upload oversized `10GB` mock video buffers. Token manipulation tests involve attempting cross-user data enumeration by tampering with the UUID parameters, ensuring the API immediately drops unauthorized payload attempts with appropriate HTTP 403 Forbidden responses.

#### 7.1.4 Validation Testing
Validation checks confirm the correct handling of all structural inputs. We tested constraints such as users uploading 0-second video responses, submitting non-English audio loops to the speech engine, or providing explicitly bad responses to verify if the AI engine correctly penalizes bad behavior.

#### 7.1.5 User Acceptance Testing (UAT)
UAT testing involves human testers performing the complete expected applicant lifecycle. Testers registered profiles, recorded their webcams answering various questions, and evaluated how quickly and smoothly the React Dashboard generated graphical representations of their final Gaze and Confidence metrics via charting libraries.

#### 7.1.6 Performance Testing
Performance stress-testing measures query latencies on the PostgreSQL database under varying row loads to confirm the B-Tree indexing effectively reduces read times. Time-to-process latency on the Computer Vision engine is also heavily tested against multi-megabyte video sizes to establish expected average wait times for candidates awaiting their Dashboard updates.


### 7.2 Test Cases

#### Table 7.1. Authentication and Session Management Test Cases

| S.No | Description | Input | Expected Output | Actual Output | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Valid Candidate Registration | Standard email + strong password + full name. | Account created, BCrypt hash stored, UUID generated, redirected to Dashboard. | Profile generated, redirected to Dashboard. | Pass |
| 2 | Invalid Password Login | Correct email + wrong plaintext password. | HTTP 401 Unauthorized — "Invalid Credentials". | 401 returned; no JWT issued. | Pass |
| 3 | Secure Stateless Login | Correct email + correct password. | HTTP 200 OK — Signed JWT access token issued to client. | 200 returned; Token stored securely in browser. | Pass |
| 4 | JWT Expiry Handling | JWT token submitted past 24-hour expiration threshold. | HTTP 401 Unauthorized — "Token Expired". | 401 returned; request rejected by middleware. | Pass |
| 5 | Cross-User Data Tampering | Using Candidate A's JWT token to request `/api/interviews/candidate_B_id` | HTTP 403 Forbidden — "Unauthorized access to profile". | 403 returned; pipeline halted instantly. | Pass |
| 6 | Request without Authorization Header | Raw API call to `/api/dashboard` missing Bearer Token. | HTTP 401 Unauthorized — "No token provided". | 401 returned; redirect to login prompted. | Pass |
| 7 | Secure Logout | Valid token calls logout action on React Client. | Token cleared from client-side state/storage, route pushed to `/login`. | Token erased; dashboard inaccessible. | Pass |

<br/>

#### Table 7.2. Video Processing, Computer Vision & NLP Analytics

| S.No | Description | Input | Expected Output | Actual Output | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 8 | Video Chunk Uploading | Valid React `MediaRecorder` 2000ms `.webm` blob chunks. | Node buffers the chunk payloads seamlessly, responds with HTTP 202 Accepted. | Video compiles smoothly on Node filesystem. | Pass |
| 9 | Facial Landmark Capture (CV) | Standard lighting video where user stares directly at camera lens. | NumPy variance returns extremely low numbers, yielding >95/100 Gaze Score. | Coordinate shift calculated <2%; Gaze Score: 98/100. | Pass |
| 10 | Severe Head Movement (CV) | Video contains candidate rapidly looking off-screen left and right. | NumPy matrix detects high variance, violently dropping the "Head Stability" metric. | Coordinate drift exceeds 40%; Stability Score drops to 45/100. | Pass |
| 11 | Linguistic Filler Density (NLP) | Candidate audio transcript heavily saturated with "um", "uh", "literally". | Regex parser triggers multiple hits, heavily penalizing the "Structural Confidence" score. | 35 filler words detected; Confidence penalty applied (-25%). | Pass |
| 12 | Poor Quality Response Check | User provides a bad answer that is irrelevant to the prompted question. | NLP Semantic mapping identifies zero technical keywords, generating a significantly low Score. | Score penalized heavily; Semantic similarity calculated at 12%. | Pass |
| 13 | Silent/Inaudible Video | User submits video with a broken microphone / zero audio waveforms. | Speech transcription fails gracefully; assigns 0 to Verbal variables and flags manual review. | Evaluation computes 0% for speech; avoids crashing. | Pass |
| 14 | Hardware Disconnection | User's browser arbitrarily loses WebCam hardware permissions mid-answer. | React UI catches Exception; pushes existing localized blob buffer to ensure partial grading. | Stream halted; 15-second partial video submitted successfully. | Pass |
| 15 | Zero-Second Video Anomaly | An artificially corrupted 0-second video bypasses UI and hits Node API. | Python OS Child Process rejects file format; returns HTTP 400 Bad Request to prevent math `DivByZero` fatal errors. | Engine safely rejects; no DB insertion made. | Pass |

<br/>

#### Table 7.3. Final Interview Results & Reporting Test Cases

| S.No | Description | Input | Expected Output | Actual Output | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 16 | Final Score Aggregation | Database triggers averaging of Gaze (90/100) and Confidence (80/100). | System correctly computes Final Percentage (85%) mathematically in the SQL layer. | 85% accurately computed and rendered. | Pass |
| 17 | Expected Failure Output | User intentionally gave terrible answers resulting in <30% scores across the board. | System correctly averages the failing variables and finalizes a Low Failure result overall. | 28% overall score; system correctly failed the candidate. | Pass |
| 18 | Expected Pass Output | User intentionally gave a flawless interview targeting the requested technical specs. | Final variables are aggregated dynamically to reflect a High Pass without anomalies. | 95% overall score; system correctly passed candidate. | Pass |
| 19 | Pass/Fail Thresholding UI | Final Interview aggregate score falls below the 60% requirement bound. | Dashboard conditionally renders "Retry Required" warning flag for the candidate. | "Interview Failed - Retry" rendered in red UI text. | Pass |
| 20 | PDF Report Generation | Candidate clicks "Download Final Report" on the result dashboard. | Node constructs a dynamic PDF file mapping the finalized integer scores & semantic charts. | Binary PDF downloaded flawlessly maintaining all feedback context. | Pass |
| 21 | Interview History Persistence | User queries "Past Interviews" tab testing historical retention mechanism. | PostgreSQL successfully retrieves unmodified JSONB feedback payload originating months prior. | Previous historical scores successfully fetched and rendered perfectly. | Pass |
| 22 | Perfect Score Anomaly | System is artificially fed an interview with mathematically zero heuristic flaws. | Final payload limits boundary cleanly at precisely 100/100 without numerical overflow errors. | Output capped accurately at maximum valid bounds. | Pass |
