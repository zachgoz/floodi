/**
 * @fileoverview Placeholder component for development and exploration
 *
 * This is a simple placeholder component that was generated with the Ionic React starter template.
 * It provides a basic layout with a title and link to Ionic documentation. Currently used in
 * the About page (Tab3) as a placeholder for future content expansion.
 *
 * Purpose:
 * - Serves as a development placeholder during app construction
 * - Provides quick access to Ionic documentation for developers
 * - Can be extended or replaced with actual content as the app evolves
 */

import './ExploreContainer.css';

/**
 * Props interface for ExploreContainer component
 *
 * @interface ContainerProps
 * @property {string} name - The title/name to display in the container
 */
interface ContainerProps {
  name: string;
}

/**
 * ExploreContainer Component
 *
 * A basic placeholder component that displays a title and link to Ionic documentation.
 * This component was included with the Ionic starter template and serves as a development
 * aid and content placeholder.
 *
 * Features:
 * - Displays a customizable title
 * - Provides link to Ionic UI components documentation
 * - Uses external link best practices (target="_blank", rel attributes)
 * - Styled with dedicated CSS file
 *
 * Usage Notes:
 * - Currently used in Tab3 (About page) as placeholder content
 * - Can be removed or replaced with actual app content as needed
 * - Useful during development for quick access to Ionic docs
 *
 * @component
 * @param {ContainerProps} props - Component props
 * @param {string} props.name - The title to display in the container
 * @returns {JSX.Element} A container with title and documentation link
 *
 * @example
 * // Basic usage with custom title
 * <ExploreContainer name="Tab 1" />
 *
 * @example
 * // As used in Tab3 About page
 * <ExploreContainer name="About FloodCast" />
 */
const ExploreContainer: React.FC<ContainerProps> = ({ name }) => {
  return (
    <div className="container">
      {/* Display the provided name/title */}
      <strong>{name}</strong>
      
      {/* Link to Ionic documentation with security attributes */}
      <p>
        Explore{' '}
        <a
          target="_blank"           // Open in new tab/window
          rel="noopener noreferrer" // Security: prevent access to window.opener
          href="https://ionicframework.com/docs/components"
        >
          UI Components
        </a>
      </p>
    </div>
  );
};

export default ExploreContainer;
