(() => {
  function createsNewSingleSeat(allSeats, selectedGroup) {
    const selected = new Set(selectedGroup.map((seat) => `${seat.row}:${seat.number}`));
    const emptyRuns = (includeSelection) => {
      const runs = [];
      for (const row of [...new Set(allSeats.filter(Boolean).map((seat) => seat.row))]) {
        const seats = allSeats.filter((seat) => seat?.row === row).sort((a,b) => a.number-b.number);
        const steps = seats.slice(1).map((seat,index) => Math.abs(seat.x-seats[index].x)).filter((step) => Number.isFinite(step) && step > 0).sort((a,b)=>a-b);
        const pitch = steps[0];
        let run = [], previous;
        const finish = () => { if (run.length) runs.push(run); run=[]; };
        for (const seat of seats) {
          const physicallyAdjacent = previous && seat.number === previous.number + 1 && (!pitch || !Number.isFinite(seat.x) || !Number.isFinite(previous.x) || Math.abs(seat.x-previous.x) <= pitch*1.35);
          if (previous && !physicallyAdjacent) finish();
          const blocked = seat.disabled || (includeSelection && selected.has(`${seat.row}:${seat.number}`));
          if (blocked) finish(); else run.push(seat);
          previous = seat;
        }
        finish();
      }
      return runs;
    };
    const existingSingles = new Set(emptyRuns(false).filter((run)=>run.length===1).map((run)=>`${run[0].row}:${run[0].number}`));
    return emptyRuns(true).some((run)=>run.length===1&&!existingSingles.has(`${run[0].row}:${run[0].number}`));
  }

  function chooseGroups(allSeats, quantity) {
    const groups = [];
    const rows = [...new Set(allSeats.filter(Boolean).map((seat) => seat.row))];
    for (const row of rows) {
      const geometry = allSeats.filter((seat) => seat?.row === row).sort((a, b) => a.number - b.number);
      const steps = geometry.slice(1).map((seat, index) => Math.abs(seat.x - geometry[index].x)).filter((step) => Number.isFinite(step) && step > 0);
      const pitch = Math.min(...steps);
      const available = geometry.filter((seat) => !seat.disabled);
      for (let index = 0; index <= available.length - quantity; index++) {
        const group = available.slice(index, index + quantity);
        const contiguous = group.every((seat, offset) => {
          if (!offset) return true;
          const previous = group[offset - 1];
          return seat.number === previous.number + 1 && (!Number.isFinite(pitch) || !Number.isFinite(seat.x) || !Number.isFinite(previous.x) || Math.abs(seat.x - previous.x) <= pitch * 1.35);
        });
        if (contiguous && !createsNewSingleSeat(allSeats, group)) groups.push(group);
      }
    }
    return groups;
  }

  const key = (seat) => `${seat.row}:${seat.number}`;
  function chooseSeats(allSeats, quantity, excluded = new Set()) {
    const permitted = (group) => !excluded.has(group.map(key).sort().join("|"));
    const contiguous = chooseGroups(allSeats, quantity).find(permitted);
    if (contiguous) return contiguous;
    // Combine entire empty runs or leave at least two empty seats in each run.
    // This keeps the cinema's single-empty-seat restriction for scattered seats too.
    const available = allSeats.filter((seat) => seat && !seat.disabled);
    const ranked = chooseGroups(allSeats, 1).flat();
    const priority = new Map(ranked.map((seat, index) => [key(seat), index]));
    available.sort((a, b) => (priority.get(key(a)) ?? 10000) - (priority.get(key(b)) ?? 10000));
    let visited = 0, result = [];
    function search(index, group) {
      if (++visited > 50000) return false;
      if (group.length === quantity) {
        if (!createsNewSingleSeat(allSeats, group) && permitted(group)) { result = group; return true; }
        return false;
      }
      for (let i = index; i <= available.length - (quantity - group.length); i++) {
        if (search(i + 1, [...group, available[i]])) return true;
      }
      return false;
    }
    search(0, []);
    return result;
  }
  globalThis.ShowtimesSeatPlanner = { chooseSeats, createsNewSingleSeat };
})();
