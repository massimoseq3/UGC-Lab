import LegalLayout, { H2, P, UL } from './LegalLayout'
import { CONTACT_EMAIL } from './version'

export default function AcceptableUsePolicy() {
  return (
    <LegalLayout title="Acceptable Use Policy">
      <P>
        This Acceptable Use Policy ("AUP") governs your use of UGC OS. It supplements our Terms
        of Service. Violations may result in immediate suspension or termination of your
        account, removal of content, and, where appropriate, reporting to law enforcement.
      </P>

      <H2>Absolutely prohibited</H2>
      <P>You may not use the Service to create, store, distribute, or attempt to generate:</P>
      <UL>
        <li>Child sexual abuse material (CSAM) or any sexual content depicting minors.</li>
        <li>Non-consensual intimate imagery, including sexual deepfakes of real people without their explicit, informed consent.</li>
        <li>Content that promotes terrorism, incites violence against a person or group, or facilitates self-harm.</li>
        <li>Content designed to harass, threaten, dox, or impersonate a specific individual.</li>
        <li>Content that infringes copyright, trademark, right of publicity, or other intellectual-property rights you do not own or have permission to use.</li>
        <li>Malware, phishing kits, credential stuffing tools, or content meant to facilitate unauthorized access to systems.</li>
        <li>Content designed to deceive in elections, public health, or other matters of public consequence, including synthetic media of real political candidates without clear, prominent disclosure.</li>
        <li>Fraudulent endorsements, fake testimonials presented as real, or misleading product claims.</li>
        <li>Content that violates the terms of any underlying model provider (OpenAI, Google, ElevenLabs, Suno, etc.).</li>
      </UL>

      <H2>Likeness &amp; voice</H2>
      <UL>
        <li>Do not generate images, video, or voice clones of a real, identifiable person without their consent, and never of a private person.</li>
        <li>Voiceovers must use voices you have the right to use. If using ElevenLabs Voice Cloning or similar, you are responsible for securing consent.</li>
        <li>Public figures may be depicted only in clearly satirical, news, or commentary contexts that comply with applicable law and platform terms.</li>
      </UL>

      <H2>Synthetic media disclosure</H2>
      <P>
        When distributing AI-generated or AI-modified media, especially video, voice, or
        photorealistic imagery of people, you must comply with all applicable disclosure
        requirements, including but not limited to the EU AI Act (Article 50), US state
        synthetic-media laws, and the policies of the platform you publish to.
      </P>

      <H2>API key &amp; abuse</H2>
      <UL>
        <li>Do not share your account or API key with people outside your community membership.</li>
        <li>Do not attempt to bypass the access list, rate limits, billing, or content filters.</li>
        <li>Do not use the Service to power a re-sale or wrapper product without our prior written consent.</li>
      </UL>

      <H2>Your responsibility for outputs</H2>
      <P>
        AI outputs can be inaccurate or unsafe. You are solely responsible for reviewing
        outputs before publishing or distributing them, and for any consequences arising from
        their use. Treat outputs as drafts, not finished work.
      </P>

      <H2>Reporting</H2>
      <P>
        To report a violation of this AUP, email{' '}
        <a className="text-ink-100 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        Include a description, URL or asset id, and any supporting evidence.
      </P>
    </LegalLayout>
  )
}
