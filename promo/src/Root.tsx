import React from "react";
import { Composition, Sequence } from "remotion";
import { BrandOpen, Close, Lifecycle, PinWallet, Shelf, Subcontract } from "./scenes";

const Demo: React.FC = () => (
  <>
    <Sequence from={0} durationInFrames={150}>
      <BrandOpen />
    </Sequence>
    <Sequence from={150} durationInFrames={270}>
      <Shelf />
    </Sequence>
    <Sequence from={420} durationInFrames={480}>
      <Lifecycle />
    </Sequence>
    <Sequence from={900} durationInFrames={390}>
      <Subcontract />
    </Sequence>
    <Sequence from={1290} durationInFrames={270}>
      <PinWallet />
    </Sequence>
    <Sequence from={1560} durationInFrames={180}>
      <Close />
    </Sequence>
  </>
);

export const Root: React.FC = () => (
  <Composition id="StublyDemo" component={Demo} durationInFrames={1740} fps={30} width={1920} height={1080} />
);
