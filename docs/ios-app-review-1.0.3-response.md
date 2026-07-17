# Makaron 1.0.3 App Review Response

Submission referenced by Apple: `d05b51bf-c8cf-4ef6-beda-613eb41ccfb2`

## Reply to App Review

Hello App Review Team,

Thank you for the detailed feedback. We addressed all three issues in Makaron 1.0.3.

1. Guideline 5.2.1 - Intellectual Property

We removed all football templates and related visual assets that could resemble FIFA or other third-party football branding from the app and its remotely served content. These templates are no longer returned by our public Skill API and are not visible or accessible in the app. Makaron does not claim any affiliation with or authorization from FIFA.

2. Guidelines 5.1.1(i) and 5.1.2(i) - AI Data Sharing

The iOS app now presents a clear AI data processing consent screen before the application content that can initiate AI processing is mounted. It explains:

- what is sent: user-selected photos, videos, audio, prompts, chat messages, and generated content needed for follow-up edits;
- who receives it: the named AI model providers and processing gateways used by Makaron;
- why it is sent: only to perform the creative action requested by the user.

The user can choose "Allow AI processing and continue" or "Not now." If the user does not allow it, AI processing remains disabled and no user content is sent to third-party AI services. The choice is stored only after the user explicitly allows it.

We also updated the Privacy Policy at https://www.makaron.app/privacy to identify the data collected, the AI providers and processing services, the purpose of processing, and the privacy protections required of service providers.

3. Guideline 1.1 - Objectionable Content

We removed the Rainy Kiss template and all other public templates that depict or instruct the generation of intimate physical contact. The removed templates are no longer returned by the public Skill API and are not visible or accessible in the app.

Review steps:

1. Install or reset Makaron 1.0.3.
2. Launch the app.
3. The AI processing consent screen appears before the creative application content.
4. Tap "Not now" to confirm AI processing remains disabled, or return and tap "Allow AI processing and continue" to enter the app.
5. Browse the Skill gallery to confirm the football/FIFA-like and intimate-contact templates are absent.

Please let us know if any additional information is needed.

Best regards,
Makaron Team

## Submission Checklist

- Upload a new 1.0.3 build containing the consent gate.
- Confirm https://www.makaron.app/privacy shows the July 15, 2026 policy.
- Paste the response above into Resolution Center and App Review Notes.
- Attach screenshots of the English consent screen and the updated Skill gallery.
- Do not attach FIFA authorization documents; the relevant content has been removed instead.
