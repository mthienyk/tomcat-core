const normalizeName = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const namesMatch = (retrieved: string, expected: string): boolean => {
  const left = normalizeName(retrieved);
  const right = normalizeName(expected);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
};

export const relevanceGrade = (
  retrievedName: string,
  expectedOrdered: readonly string[],
): number => {
  for (let index = 0; index < expectedOrdered.length; index += 1) {
    if (namesMatch(retrievedName, expectedOrdered[index]!)) {
      return expectedOrdered.length - index;
    }
  }
  return 0;
};

export const dcgAtK = (grades: readonly number[], k: number): number => {
  let sum = 0;
  for (let index = 0; index < Math.min(k, grades.length); index += 1) {
    const grade = grades[index] ?? 0;
    if (grade <= 0) continue;
    sum += grade / Math.log2(index + 2);
  }
  return sum;
};

export const ndcgAtK = (
  retrievedNames: readonly string[],
  expectedOrdered: readonly string[],
  k: number,
): number => {
  if (expectedOrdered.length === 0) return 0;

  const retrievedGrades = retrievedNames
    .slice(0, k)
    .map((name) => relevanceGrade(name, expectedOrdered));
  const idealGrades = expectedOrdered
    .slice(0, k)
    .map((_name, index) => expectedOrdered.length - index);

  const dcg = dcgAtK(retrievedGrades, k);
  const idcg = dcgAtK(idealGrades, k);
  if (idcg === 0) return 0;
  return Number((dcg / idcg).toFixed(4));
};

export const hitAtK = (
  retrievedNames: readonly string[],
  expectedNames: readonly string[],
  k: number,
): boolean => {
  const slice = retrievedNames.slice(0, k);
  return expectedNames.some((expected) =>
    slice.some((retrieved) => namesMatch(retrieved, expected)),
  );
};

export const recallInTopK = (
  retrievedNames: readonly string[],
  expectedNames: readonly string[],
  k: number,
): number => {
  if (expectedNames.length === 0) return 0;
  const hits = expectedNames.filter((expected) =>
    retrievedNames
      .slice(0, k)
      .some((retrieved) => namesMatch(retrieved, expected)),
  ).length;
  return Number((hits / expectedNames.length).toFixed(4));
};
