function studentPhotoUrl(profile) {
  if (!profile) return null;
  if (profile.photoUrl) return profile.photoUrl;
  if (!profile.id) return null;
  const version = profile.updatedAt ? new Date(profile.updatedAt).getTime() : "";
  return `/api/students/${profile.id}/photo${version ? `?v=${version}` : ""}`;
}

module.exports = { studentPhotoUrl };
