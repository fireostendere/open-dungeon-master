/** Receipt recovery must not replay an effect when only its readback failed. */
export async function attachPostWriteRead(receipt, readParams, read) {
  try {
    const fresh = await read(readParams);
    return { ...receipt, state: fresh, readAfter: readParams, readRequired: false };
  } catch {
    return { ...receipt, readAfter: readParams, readRequired: true,
      readError: 'Post-commit state unavailable; read before another write. The receipt is already committed.' };
  }
}
