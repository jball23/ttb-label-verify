'use client';

import { useState } from 'react';
import { Header, Title, NavMenuButton, PrimaryNav } from '@trussworks/react-uswds';
import AboutModal from './about-modal';

export default function PageHeader() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const links = [
    <button
      key="about"
      type="button"
      className="usa-nav__link"
      onClick={() => setAboutOpen(true)}
    >
      <span>About this tool</span>
    </button>,
  ];

  return (
    <>
      <Header basic showMobileOverlay={mobileNavOpen}>
        <div className="usa-nav-container">
          <div className="usa-navbar">
            <Title>TTB Label Verification</Title>
            <NavMenuButton
              label="Menu"
              onClick={() => setMobileNavOpen((v) => !v)}
            />
          </div>
          <PrimaryNav
            items={links}
            mobileExpanded={mobileNavOpen}
            onToggleMobileNav={() => setMobileNavOpen((v) => !v)}
          />
        </div>
      </Header>
      <AboutModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
