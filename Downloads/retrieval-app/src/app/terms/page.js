import { LegalPage } from "../../components/LegalPage";

export const metadata = { title: "Terms of use", description: "Terms for use of the Feynman Education retrieval application." };

const sections = [
  { id: "agreement", title: "Using the service", content: <><p>These terms govern access to the Feynman Education retrieval application. A school pilot or paid licence may also have an order form or school agreement; where that document expressly differs, its terms take priority for that school.</p><p>Users must provide accurate account information, protect their credentials and use only the role and school access assigned to them.</p></> },
  { id: "acceptable-use", title: "Acceptable use", content: <><p>Do not attempt to bypass access controls, obtain another user’s data, disrupt the service, upload unlawful material, probe the system without permission or use the product in a way that puts pupils or staff at risk. Teachers are responsible for ensuring their uploaded question-bank content is appropriate and that they have permission to use it.</p></> },
  { id: "education", title: "Educational and AI output", content: <><p>Marking and feedback are educational support, not an official examination-board result. AI and automated checks can make mistakes. Schools and teachers remain responsible for consequential assessment decisions and should use the review controls where a mark is uncertain or disputed.</p></> },
  { id: "accounts", title: "Accounts and access", content: <><p>Teacher and elevated roles are provisioned by authorised staff. Public sign-up is intended for pupils unless another arrangement is explicitly offered. We may suspend access necessary to investigate misuse, protect users or maintain the service.</p></> },
  { id: "availability", title: "Availability and changes", content: <><p>We aim to keep the service useful and available but cannot promise uninterrupted operation. Features may change as the product develops. Material changes affecting a school’s agreed service should be communicated through the relevant school contact.</p></> },
  { id: "content", title: "Content and ownership", content: <><p>Schools and users retain responsibility for content they upload. They grant the permission needed to store, process and display that content to provide the service. The application, interface and shared Feynman question-bank material remain protected by their applicable intellectual-property rights.</p></> },
  { id: "ending", title: "Ending use", content: <><p>Users can stop using the service. School data export, retention and deletion should follow the school agreement or an agreed offboarding process so learning records and account relationships are handled safely.</p></> },
  { id: "contact", title: "Contact", content: <><p>Questions about these terms can be sent to <a href="mailto:schools@feynmaneducation.com">schools@feynmaneducation.com</a>.</p><div className="legal-note">These web terms are a practical baseline for the current product. A school should rely on the signed order form and data-processing terms used for its purchase.</div></> },
];

export default function TermsPage() {
  return <LegalPage eyebrow="Legal information" title="Terms of use" intro="The ground rules for using Feynman Education responsibly and for treating AI marking as teacher-supported educational evidence." sections={sections} />;
}

