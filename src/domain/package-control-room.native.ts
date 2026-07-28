function unavailable(): never {
  throw new Error('package_control_room_unavailable_on_native');
}

export function approveControlRoomPreview(): never {
  return unavailable();
}

export function indexPackageSourceTree(): {
  schemaVersion: 'wonder.package-control-room.source-tree.v1';
  packageKey: string;
  sections: [];
} {
  return {
    schemaVersion: 'wonder.package-control-room.source-tree.v1',
    packageKey: 'native-unavailable',
    sections: [],
  };
}

export function previewControlRoomChange(): never {
  return unavailable();
}

export function proposeAiScreenPatch(): never {
  return unavailable();
}

export function proposeCollectionFieldPatch(): never {
  return unavailable();
}

export function activateApprovedControlRoomChange(): never {
  return unavailable();
}

export type ControlRoomPreview = never;
export type ControlRoomProposal = never;
