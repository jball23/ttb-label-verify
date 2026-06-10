'use client';

import { useRef, useEffect } from 'react';
import { Modal, ModalHeading, ModalRef, ModalToggleButton } from '@trussworks/react-uswds';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: Props) {
  const modalRef = useRef<ModalRef>(null);

  useEffect(() => {
    if (isOpen) modalRef.current?.toggleModal(undefined, true);
    else modalRef.current?.toggleModal(undefined, false);
  }, [isOpen]);

  return (
    <Modal
      ref={modalRef}
      id="about-modal"
      aria-labelledby="about-modal-heading"
      aria-describedby="about-modal-description"
      isInitiallyOpen={false}
    >
      <ModalHeading id="about-modal-heading">About this tool</ModalHeading>
      <div id="about-modal-description" className="usa-prose">
        <p>
          This is a prototype demonstrating AI-assisted TTB compliance checks on
          alcohol beverage labels. Upload one or more label images; the tool
          extracts the regulated fields and validates them against TTB rules.
        </p>
        <p>
          <strong>What this tool does not do:</strong>
        </p>
        <ul>
          <li>Store uploaded images. Files are processed in memory and discarded.</li>
          <li>Store any personally identifiable information.</li>
          <li>Submit labels to COLA. This is standalone.</li>
          <li>
            Replace human review. The tool surfaces probable issues; final
            compliance judgments stay with a qualified reviewer.
          </li>
        </ul>
        <p>
          See the GitHub repository&apos;s README for architecture, trade-offs,
          and the Azure OpenAI production migration path.
        </p>
      </div>
      <ModalToggleButton modalRef={modalRef} closer onClick={onClose}>
        Close
      </ModalToggleButton>
    </Modal>
  );
}
