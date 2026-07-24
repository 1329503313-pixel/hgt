import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { UnifiedBackButton } from "../components/UnifiedBackButton";
import { siteContentBySlug, type SiteContentSlug } from "../shared/siteContent";

interface SiteContentLocationState {
  returnTo?: string;
}

export default function SiteContentPage() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const document = siteContentBySlug.get(slug as SiteContentSlug);
  const returnTo = (location.state as SiteContentLocationState | null)?.returnTo;

  if (!document) {
    return <Navigate to="/" replace />;
  }

  function handleBack() {
    navigate(returnTo || "/", { replace: true });
  }

  return (
    <main className="site-content-page">
      <div className="site-content-shell">
        <div className="site-content-back">
          <UnifiedBackButton onClick={handleBack} />
        </div>

        <article className="site-content-article">
          <header className="site-content-heading">
            <div className="site-content-heading-mark">
              <img src="/favicon.svg" alt="" aria-hidden="true" />
            </div>
            <div>
              <span>{document.eyebrow}</span>
              <h1>{document.title}</h1>
              <p>{document.summary}</p>
            </div>
          </header>

          <div className="site-content-body">
            {document.sections.map((section, sectionIndex) => (
              <section key={`${document.slug}-${sectionIndex}`}>
                {section.title && <h2>{section.title}</h2>}
                {section.paragraphs?.map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul>
                    {section.bullets.map((bullet, bulletIndex) => (
                      <li key={bulletIndex}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </article>
      </div>
    </main>
  );
}
